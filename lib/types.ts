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
