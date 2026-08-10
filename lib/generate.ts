import { generateNames } from "./anthropic.ts";
import { LIBRARY } from "./library.ts";
import { nameKey } from "./nameKey.ts";
import { scoreCandidate, type StyleProfile } from "./profile.ts";
import { shuffle, weightedOrder } from "./sample.ts";
import type { Candidate, Decision, Gender, Preferences } from "./types.ts";

export interface TopUpResult {
  candidates: Candidate[];
  meta: {
    requested: number;
    fromLibrary: number;
    fromAi: number;
    aiReturned: number;
    aiRejected: number;
    short: boolean;
  };
}

const VALID_GENDERS: Gender[] = ["girl", "boy", "neutral"];

export async function buildTopUp(opts: {
  gender: "girl" | "boy";
  count: number;
  liked: Decision[];
  recentPasses: Decision[];
  prefs: Preferences;
  profile: StyleProfile;
  /** name_keys already decided on OR already sitting in the queue */
  excluded: Set<string>;
  allowAi: boolean;
}): Promise<TopUpResult> {
  const { gender, count, prefs, profile, excluded } = opts;

  // ---- 1. Library pool -----------------------------------------------------
  const pool = LIBRARY.filter((c) => {
    if (c.gender !== gender && c.gender !== "neutral") return false;
    if (excluded.has(c.name_key)) return false;
    if (profile.hardOrigins && c.origin && !profile.hardOrigins.has(c.origin))
      return false;
    return true;
  });

  const ordered = weightedOrder(pool, (c) => scoreCandidate(c, profile));

  const nSimilar = Math.round(count * prefs.similar_new_mix);
  const nNew = count - nSimilar;

  const similar = ordered.slice(0, nSimilar);
  const leftovers = ordered.slice(nSimilar);

  // ---- 2. AI pool ----------------------------------------------------------
  const taken = new Set(similar.map((c) => c.name_key));
  const aiPicked: Candidate[] = [];
  let aiReturned = 0;

  if (opts.allowAi && nNew > 0) {
    let raw: Awaited<ReturnType<typeof generateNames>> = [];
    try {
      raw = await generateNames({
        gender,
        // Over-ask: a good share will collide with the exclusion set.
        count: Math.ceil(nNew * 1.5),
        liked: opts.liked,
        recentPasses: opts.recentPasses,
        prefs,
        profile,
      });
    } catch (err) {
      // AI is a nice-to-have. Never let it break the queue.
      console.error("[generate] AI top-up failed, falling back to library", err);
    }
    aiReturned = raw.length;

    // ---- 3. Dedupe. THIS is the never-repeat guarantee; the model is only
    //         ever a source of candidates, never the gatekeeper.
    for (const n of raw) {
      if (aiPicked.length >= nNew) break;
      const key = nameKey(n.name);
      if (!key) continue;
      if (excluded.has(key) || taken.has(key)) continue;
      taken.add(key);
      aiPicked.push({
        name_key: key,
        display: n.name.trim(),
        gender: VALID_GENDERS.includes(n.gender) ? n.gender : gender,
        origin: n.origin?.trim() || null,
        tags: [],
        source: "ai",
      });
    }
  }

  // ---- 4. Top up any shortfall from the leftover weighted sample ------------
  const out = [...similar, ...aiPicked];
  for (const c of leftovers) {
    if (out.length >= count) break;
    if (taken.has(c.name_key)) continue;
    taken.add(c.name_key);
    out.push(c);
  }

  return {
    candidates: shuffle(out),
    meta: {
      requested: count,
      fromLibrary: out.filter((c) => c.source === "library").length,
      fromAi: aiPicked.length,
      aiReturned,
      aiRejected: aiReturned - aiPicked.length,
      // Coming up short is a valid outcome, never an error.
      short: out.length < count,
    },
  };
}
