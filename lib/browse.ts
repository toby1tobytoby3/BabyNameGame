import { analyse, type Ending, type NameTraits } from "./analyse.ts";
import { sql, t } from "./db.ts";
import { fitScore, type TasteProfile } from "./insights.ts";
import { LIBRARY } from "./library.ts";
import type { Gender } from "./types.ts";

export type NameStatus = "new" | "liked" | "passed" | "queued";

export interface BrowseName {
  name_key: string;
  display: string;
  gender: Gender;
  origin: string | null;
  status: NameStatus;
  syllables: number;
  ending: Ending;
  hardness: number;
  hasDouble: boolean;
  /** 0–1 against the closest name on the shortlist, or null with no taste yet. */
  fit: number | null;
  /** Which shortlisted name it takes after. */
  like: string | null;
}

export type SortKey = "fit" | "az" | "short" | "long";

export interface BrowseQuery {
  q: string;
  gender: "all" | Gender;
  syllables: "any" | "1" | "2" | "3+";
  ending: "any" | "vowel" | "consonant" | Ending;
  feel: "any" | "soft" | "hard";
  origin: string | null;
  hideSeen: boolean;
  sort: SortKey;
  limit: number;
  offset: number;
}

export const DEFAULT_QUERY: BrowseQuery = {
  q: "",
  gender: "all",
  syllables: "any",
  ending: "any",
  feel: "any",
  origin: null,
  hideSeen: false,
  sort: "az",
  limit: 60,
  offset: 0,
};

interface Entry {
  name_key: string;
  display: string;
  gender: Gender;
  origin: string | null;
  traits: NameTraits;
  /** Lowercased display + origin, for search. */
  haystack: string;
}

/**
 * The library, analysed once.
 *
 * Traits are computed here rather than read from `name_traits` on purpose: the
 * analyser is a pure function of the spelling, the library is static and
 * already in memory, and this way the browser works whether or not the table
 * has been backfilled. The table stays what it was built for — aggregate
 * questions about the names you have actually decided on.
 */
let analysed: Entry[] | null = null;
function libraryEntries(): Entry[] {
  if (analysed) return analysed;
  analysed = LIBRARY.map((c) => ({
    name_key: c.name_key,
    display: c.display,
    gender: c.gender,
    origin: c.origin,
    traits: analyse(c.display, c.origin),
    haystack: `${c.display} ${c.origin ?? ""}`.toLowerCase(),
  }));
  return analysed;
}

/**
 * Soft and hard are the outer thirds of the library's own spread, not fixed
 * numbers — so the words keep meaning what they say if the library changes.
 */
let bands: { soft: number; hard: number } | null = null;
function feelBands() {
  if (bands) return bands;
  const sorted = libraryEntries()
    .map((e) => e.traits.hardness)
    .sort((a, b) => a - b);
  bands = {
    soft: sorted[Math.floor(sorted.length / 3)],
    hard: sorted[Math.floor((2 * sorted.length) / 3)],
  };
  return bands;
}

export function originOptions(): string[] {
  return [...new Set(LIBRARY.map((c) => c.origin).filter(Boolean))].sort() as string[];
}

function matches(e: Entry, status: NameStatus, query: BrowseQuery): boolean {
  const { traits: tr } = e;
  if (query.q && !e.haystack.includes(query.q.toLowerCase())) return false;
  if (query.gender !== "all" && e.gender !== query.gender) return false;
  if (query.hideSeen && status !== "new") return false;

  if (query.syllables !== "any") {
    const want = query.syllables;
    if (want === "3+" ? tr.syllables < 3 : tr.syllables !== Number(want)) return false;
  }

  if (query.ending !== "any") {
    const isVowel = tr.ending.startsWith("vowel");
    if (query.ending === "vowel" && !isVowel) return false;
    else if (query.ending === "consonant" && isVowel) return false;
    else if (query.ending !== "vowel" && query.ending !== "consonant" &&
             tr.ending !== query.ending) return false;
  }

  if (query.feel !== "any") {
    const b = feelBands();
    if (query.feel === "soft" && tr.hardness > b.soft) return false;
    if (query.feel === "hard" && tr.hardness < b.hard) return false;
  }

  if (query.origin && e.origin !== query.origin) return false;
  return true;
}

/**
 * Every name the app knows, filtered and ranked.
 *
 * Names decided on outside the library (hand-added, or generated) are folded in
 * so "all names" means all of them, not just the bundled ones.
 */
export async function browseNames(
  query: BrowseQuery,
  profile: TasteProfile | null,
): Promise<{ names: BrowseName[]; total: number }> {
  const [decided, queued] = await Promise.all([
    sql<{ name_key: string; display: string; gender: Gender; origin: string | null; verdict: string }[]>`
      SELECT name_key, display, gender, origin, verdict FROM ${t("decisions")}`,
    sql<{ name_key: string }[]>`SELECT name_key FROM ${t("queue")}`,
  ]);

  const statusOf = new Map<string, NameStatus>();
  for (const d of decided) {
    statusOf.set(d.name_key, d.verdict === "like" ? "liked" : "passed");
  }
  for (const q of queued) if (!statusOf.has(q.name_key)) statusOf.set(q.name_key, "queued");

  const known = new Set(libraryEntries().map((e) => e.name_key));
  const extras: Entry[] = decided
    .filter((d) => !known.has(d.name_key))
    .map((d) => ({
      name_key: d.name_key,
      display: d.display,
      gender: d.gender,
      origin: d.origin,
      traits: analyse(d.display, d.origin),
      haystack: `${d.display} ${d.origin ?? ""}`.toLowerCase(),
    }));

  const hits: BrowseName[] = [];
  for (const e of [...libraryEntries(), ...extras]) {
    const status = statusOf.get(e.name_key) ?? "new";
    if (!matches(e, status, query)) continue;
    // Only when it is actually being used to rank: matching every candidate
    // against every liked name is cheap but not free.
    const fit = profile && query.sort === "fit" ? fitScore(e.traits, profile) : null;
    hits.push({
      name_key: e.name_key,
      display: e.display,
      gender: e.gender,
      origin: e.origin,
      status,
      syllables: e.traits.syllables,
      ending: e.traits.ending,
      hardness: e.traits.hardness,
      hasDouble: e.traits.hasDouble,
      fit: fit?.score ?? null,
      like: fit?.like ?? null,
    });
  }

  const byName = (a: BrowseName, b: BrowseName) => a.display.localeCompare(b.display);

  /**
   * Stable, arbitrary, and — unlike alphabetical order — not biased.
   *
   * Names that match equally well genuinely have no order between them, and
   * falling back to A–Z made "best fit" open with every name beginning A.
   */
  const scatter = (key: string) => {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const sorters: Record<SortKey, (a: BrowseName, b: BrowseName) => number> = {
    // Falls back to A–Z when there is no taste to rank against yet.
    fit: (a, b) =>
      (b.fit ?? 0) - (a.fit ?? 0) || scatter(a.name_key) - scatter(b.name_key),
    az: byName,
    short: (a, b) => a.display.length - b.display.length || byName(a, b),
    long: (a, b) => b.display.length - a.display.length || byName(a, b),
  };
  hits.sort(sorters[query.sort]);

  return {
    total: hits.length,
    names: hits.slice(query.offset, query.offset + query.limit),
  };
}
