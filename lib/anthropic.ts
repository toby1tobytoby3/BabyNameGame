import Anthropic from "@anthropic-ai/sdk";
import type { Decision, Gender, Preferences } from "./types.ts";
import { describeProfile, type StyleProfile } from "./profile.ts";

export interface AiName {
  name: string;
  gender: Gender;
  origin: string;
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5";

const SYSTEM_PROMPT = `You suggest baby names for a couple who are browsing candidates.

You will be given the names they have LIKED, a sample of names they have PASSED
on, their stated origin preferences, and a short description of their style.

Return fresh candidates that fit their taste. Guidelines:
- Suggest real, attested given names that a person could plausibly be called.
  Do not invent names, and do not return surnames or place names.
- Match the *feel* of the liked names — sound, length, rhythm, cultural register
  — not just the literal origins.
- The passed names are a negative signal. Avoid names that are close variants of
  something they already rejected.
- Do not repeat any name that appears in the liked or passed lists.
- Vary your suggestions: do not return a run of near-identical names.
- "origin" should be a short cultural label such as "Irish", "Scandinavian",
  "Italian", "Yoruba (West African)".`;

/**
 * The response schema. Structured outputs guarantee well-formed, schema-valid
 * JSON — they do not guarantee the names are real or unseen, so every caller
 * still runs the code-side dedupe in generate.ts.
 */
const NAME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["names"],
  properties: {
    names: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "gender", "origin"],
        properties: {
          name: { type: "string" },
          gender: { type: "string", enum: ["girl", "boy", "neutral"] },
          origin: { type: "string" },
        },
      },
    },
  },
};

function sampleLiked(liked: Decision[]): Decision[] {
  if (liked.length <= 150) return liked;
  const byRank = [...liked].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const top = byRank.slice(0, 60);
  const rest = byRank.slice(60);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...top, ...rest.slice(0, 90)];
}

export async function generateNames(opts: {
  gender: "girl" | "boy";
  count: number;
  liked: Decision[];
  recentPasses: Decision[];
  prefs: Preferences;
  profile: StyleProfile;
}): Promise<AiName[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const client = new Anthropic();
  const liked = sampleLiked(opts.liked);

  const prefLine = opts.prefs.origins.length
    ? opts.prefs.origins
        .map((o) => `${o.origin} (weight ${o.weight})`)
        .join(", ") +
      (opts.prefs.origin_mode === "hard"
        ? " — RESTRICT suggestions to these origins only."
        : " — treat as a bias, not a restriction.")
    : "none stated";

  const userContent = [
    `Suggest ${opts.count} ${opts.gender} names.`,
    ``,
    `STYLE: ${describeProfile(opts.profile)}`,
    ``,
    `ORIGIN PREFERENCES: ${prefLine}`,
    ``,
    `LIKED (${liked.length}${opts.liked.length > liked.length ? ` of ${opts.liked.length}` : ""}):`,
    liked.length ? liked.map((d) => d.display).join(", ") : "(none yet)",
    ``,
    `RECENTLY PASSED (avoid these and close variants):`,
    opts.recentPasses.length
      ? opts.recentPasses.map((d) => d.display).join(", ")
      : "(none yet)",
  ].join("\n");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    // NB: output_config also accepts `effort`, but that errors on Haiku 4.5.
    // Format only.
    output_config: { format: { type: "json_schema", schema: NAME_SCHEMA } },
  });

  if (res.stop_reason === "refusal") return [];
  if (res.stop_reason === "max_tokens") {
    // Truncated JSON. Nothing salvageable; the caller tops up from the library.
    console.warn("[anthropic] hit max_tokens, discarding truncated batch");
    return [];
  }

  const text = res.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return [];

  try {
    const parsed = JSON.parse(text.text) as { names?: unknown };
    if (!Array.isArray(parsed.names)) return [];
    return parsed.names.filter(
      (n): n is AiName =>
        !!n &&
        typeof n === "object" &&
        typeof (n as AiName).name === "string" &&
        (n as AiName).name.trim().length > 0,
    );
  } catch (err) {
    console.warn("[anthropic] unparseable response", err);
    return [];
  }
}
