export type Gender = "girl" | "boy" | "neutral";
export type Verdict = "like" | "pass";
/** Where a name came from: the bundled library, Claude, or typed in by hand. */
export type Source = "library" | "ai" | "manual";
export type GenderFilter = "all" | "girl" | "boy";

/** A row as it appears in data/library.json. */
export interface LibraryEntry {
  display: string;
  gender: Gender;
  origin: string;
  tags: string[];
}

/** A name that can be shown, queued, or decided on. */
export interface Candidate {
  name_key: string;
  display: string;
  gender: Gender;
  origin: string | null;
  tags: string[];
  source: Source;
}

/** Most hearts a single shortlisted name can carry. */
export const MAX_HEARTS = 3;

export interface Decision extends Candidate {
  verdict: Verdict;
  rank: number | null;
  /** 0–3 favourite markers. See MAX_HEARTS. */
  hearts: number;
  decided_at: string;
}

// A type alias, not an interface: interfaces get no implicit index signature,
// so they fail postgres.js's JSONValue constraint in sql.json().
export type OriginPref = {
  origin: string;
  weight: number;
};

/**
 * The origin scale runs −2 … +2 around a neutral 0: pull left to see fewer
 * names from an origin, right to see more. Zero is "no opinion" and is never
 * stored, so the absence of a row and a row at 0 mean the same thing.
 */
export const MIN_ORIGIN_WEIGHT = -2;
export const MAX_ORIGIN_WEIGHT = 2;

/**
 * Coerce a stored or submitted origins value into the scale.
 *
 * Defensive on both ends: the column is jsonb so it can hold anything, and the
 * scale used to run 0…5, so live rows carry weights this range no longer has.
 * Clamping on read means a legacy 5 behaves as +2 everywhere rather than
 * scoring off the end of the scale.
 */
export function clampOriginPrefs(value: unknown): OriginPref[] {
  if (!Array.isArray(value)) return [];
  const out: OriginPref[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const { origin, weight } = raw as Partial<OriginPref>;
    if (typeof origin !== "string" || !origin || seen.has(origin)) continue;
    const w = Math.round(Number(weight));
    if (!Number.isFinite(w) || w === 0) continue;
    seen.add(origin);
    out.push({
      origin,
      weight: Math.min(Math.max(w, MIN_ORIGIN_WEIGHT), MAX_ORIGIN_WEIGHT),
    });
  }
  return out;
}

export interface Preferences {
  origins: OriginPref[];
  similar_new_mix: number;
  origin_mode: "soft" | "hard";
  surname: string | null;
  topup_threshold: number;
}

/**
 * Coerce a tags value to a real array.
 *
 * Defensive: a jsonb column can legitimately hold a string, and iterating one
 * with for..of yields characters rather than tags — corrupting the style
 * profile silently instead of throwing. Never trust the shape on read.
 */
export function toTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((v) => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const DEFAULT_PREFERENCES: Preferences = {
  origins: [],
  similar_new_mix: 0.6,
  origin_mode: "soft",
  surname: null,
  topup_threshold: 30,
};
