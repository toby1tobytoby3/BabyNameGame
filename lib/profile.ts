import { STYLE_TAGS } from "./library.ts";
import { toTags, type Candidate, type Decision, type Preferences } from "./types.ts";

export interface StyleProfile {
  /** origin -> 0..1, blended from liked names and explicit preferences */
  originWeight: Record<string, number>;
  /** style tag -> 0..1 (origin-echo tags excluded) */
  tagWeight: Record<string, number>;
  meanLen: number;
  sd: number;
  likedCount: number;
  /** non-null only when origin_mode === 'hard' */
  hardOrigins: Set<string> | null;
}

function normalise(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) out[k] = v / total;
  return out;
}

export function buildProfile(
  liked: Decision[],
  prefs: Preferences,
): StyleProfile {
  const originCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  const lengths: number[] = [];

  for (const d of liked) {
    if (d.origin) originCounts[d.origin] = (originCounts[d.origin] ?? 0) + 1;
    for (const tag of toTags(d.tags)) {
      // Skip origin-echo tags — counting them would double-count origin.
      if (STYLE_TAGS.has(tag)) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
    }
    lengths.push(d.display.length);
  }

  const originShare = normalise(originCounts);

  const prefCounts: Record<string, number> = {};
  for (const p of prefs.origins) {
    if (p.weight > 0) prefCounts[p.origin] = p.weight;
  }
  const prefShare = normalise(prefCounts);

  // Blend liked-behaviour with stated preference.
  //
  // Two things matter here. First, a flat 0.5/0.5 split would halve the liked
  // signal even when no preferences are stated — dividing it against nothing.
  // Each side only claims half when the *other* side actually has data.
  //
  // Second, the liked signal is shrunk toward uniform when it rests on few
  // observations: one Irish like should nudge, fifty should pull hard. Without
  // this, a single early swipe would dominate the whole next chunk.
  const hasLiked = Object.keys(originShare).length > 0;
  const hasPrefs = Object.keys(prefShare).length > 0;
  const confidence = liked.length / (liked.length + 10);

  const wLiked = hasLiked ? (hasPrefs ? 0.5 : 1) * confidence : 0;
  const wPrefs = hasPrefs ? (hasLiked ? 0.5 : 1) : 0;

  const originWeight: Record<string, number> = {};
  for (const key of new Set([
    ...Object.keys(originShare),
    ...Object.keys(prefShare),
  ])) {
    originWeight[key] =
      wLiked * (originShare[key] ?? 0) + wPrefs * (prefShare[key] ?? 0);
  }

  const meanLen = lengths.length
    ? lengths.reduce((a, b) => a + b, 0) / lengths.length
    : 6;
  const variance = lengths.length
    ? lengths.reduce((a, b) => a + (b - meanLen) ** 2, 0) / lengths.length
    : 4;
  const sd = Math.max(Math.sqrt(variance), 1.5); // floor stops a narrow profile

  return {
    originWeight,
    tagWeight: normalise(tagCounts),
    meanLen,
    sd,
    likedCount: liked.length,
    hardOrigins:
      prefs.origin_mode === "hard" && prefs.origins.length
        ? new Set(prefs.origins.map((o) => o.origin))
        : null,
  };
}

/**
 * Score a library candidate against the profile. The constant floor keeps every
 * name reachable — without it, an unliked origin would become permanently
 * invisible and the exploration half of the mix would collapse.
 *
 * Coefficients are tuned against generate.test.ts: a settled single-origin
 * preference should lift that origin to roughly 3–4× its share of the library
 * (noticeably personalised) without crowding everything else out (monotonous).
 */
export function scoreCandidate(c: Candidate, p: StyleProfile): number {
  const origin = c.origin ? (p.originWeight[c.origin] ?? 0) : 0;

  const styleTags = toTags(c.tags).filter((tg) => STYLE_TAGS.has(tg));
  const tagOverlap = styleTags.length
    ? styleTags.reduce((a, tg) => a + (p.tagWeight[tg] ?? 0), 0) /
      Math.sqrt(styleTags.length)
    : 0;

  const lengthCloseness = Math.exp(
    -((c.display.length - p.meanLen) ** 2) / (2 * p.sd ** 2),
  );

  return 0.2 + 2.0 * origin + 0.5 * tagOverlap + 0.35 * lengthCloseness;
}

/** Short natural-language style description handed to the model. */
export function describeProfile(p: StyleProfile): string {
  const topOrigins = Object.entries(p.originWeight)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([o, w]) => `${o} (${Math.round(w * 100)}%)`);
  const topTags = Object.entries(p.tagWeight)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([tg]) => tg);

  const parts: string[] = [];
  if (topOrigins.length) parts.push(`Favoured origins: ${topOrigins.join(", ")}.`);
  if (topTags.length) parts.push(`Recurring qualities: ${topTags.join(", ")}.`);
  parts.push(
    `Typical liked name length: ${p.meanLen.toFixed(1)} characters (spread ±${p.sd.toFixed(1)}).`,
  );
  return parts.join(" ");
}
