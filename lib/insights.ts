import { analyse, type Ending, type NameTraits } from "./analyse.ts";
import { sql, t } from "./db.ts";
import { closeness, proportionZ, welchT, type Sample } from "./stats.ts";

/* ------------------------------------------------------------------ shape */

/** The continuous traits a finding can be made about. */
export const SCALES = [
  "letters",
  "syllables",
  "hardness",
  "softness",
  "brightness",
] as const;
export type Scale = (typeof SCALES)[number];

/** The yes/no traits a finding can be made about. */
export const FLAGS = [
  "endsVowel",
  "endsA",
  "hasDouble",
  "hasCluster",
  "longName",
] as const;
export type Flag = (typeof FLAGS)[number];

export interface Side {
  n: number;
  scales: Record<Scale, Sample>;
  flags: Record<Flag, number>;
  endings: Partial<Record<Ending, number>>;
  initials: Record<string, number>;
}

/**
 * Findings that say the same thing about a name, differently.
 *
 * Letters, syllables and "three or more syllables" all mean *short*; on real
 * data all three clear the gate together and would spend three of the card's
 * four lines on one idea. Only the strongest of each family survives, so the
 * card carries four genuinely different statements or fewer.
 */
const FAMILY: Record<string, string> = {
  letters: "length",
  syllables: "length",
  longName: "length",
  hardness: "sound",
  softness: "sound",
  hasCluster: "sound",
  endsVowel: "ending",
  endsA: "ending",
  hasDouble: "texture",
  brightness: "vowels",
};
const familyOf = (id: string) =>
  id.startsWith("initial-") ? "initial" : (FAMILY[id] ?? id);

export interface Finding {
  id: string;
  /** The sentence shown on the card. */
  claim: string;
  /** "7% of your likes" — always the liked side. */
  liked: string;
  /** "25% of names you've seen" — always the passed side. */
  passed: string;
  /** Signed: positive means the trait is more common among likes. */
  z: number;
}

export interface Taste {
  sample: { liked: number; passed: number };
  findings: Finding[];
  /** Non-null once there is enough evidence to rank names by fit. */
  profile: TasteProfile | null;
}

export interface TasteProfile {
  n: number;
  scales: Record<Scale, Sample>;
  /** Liked share per ending class, for matching shape. */
  endings: Partial<Record<Ending, number>>;
  /** How much each trait mattered — |z| from the findings, over a flat base. */
  weights: Partial<Record<Scale | "ending" | "onset" | "vowelRatio" | "double", number>>;
  /**
   * The liked names themselves, not just their average.
   *
   * Ranking against the average collapses a varied taste into a single point
   * and returns seven versions of one name. Matching each candidate to its
   * *nearest* liked name keeps the variety that is actually in the shortlist —
   * and lets a suggestion say which of your names it takes after.
   */
  liked: { display: string; traits: NameTraits }[];
}

/* ------------------------------------------------------------------ gates */

/**
 * Below this many likes the card says nothing at all.
 *
 * With a dozen likes any of these traits will look significant, and a
 * confidently wrong reading of someone's taste is worse than no reading.
 */
export const MIN_LIKED = 25;
/** ≈ p < 0.012 two-tailed. */
const MIN_Z = 2.5;
/** A share has to move by this much in relative terms to be worth a sentence. */
const MIN_LIFT = 1.35;
/** A scale has to move by this share of the passed spread. */
const MIN_SD = 0.35;
/** Never show more than this many — the card is a glance, not a report. */
const MAX_FINDINGS = 4;

/* ------------------------------------------------------------------- read */

const EMPTY_SIDE = (): Side => ({
  n: 0,
  scales: Object.fromEntries(
    SCALES.map((s) => [s, { n: 0, mean: 0, sd: 0 }]),
  ) as Record<Scale, Sample>,
  flags: Object.fromEntries(FLAGS.map((f) => [f, 0])) as Record<Flag, number>,
  endings: {},
  initials: {},
});

interface AggRow {
  verdict: string;
  n: number;
  letters_mean: number; letters_sd: number | null;
  syllables_mean: number; syllables_sd: number | null;
  hardness_mean: number; hardness_sd: number | null;
  softness_mean: number; softness_sd: number | null;
  brightness_mean: number; brightness_sd: number | null;
  ends_vowel: number; ends_a: number;
  has_double: number; has_cluster: number; long_name: number;
}

/**
 * One pass over the joined decisions, aggregated in Postgres.
 *
 * The aggregation belongs in SQL — it is what the traits table exists for —
 * but the *tests* stay in TypeScript, where they can be run against synthetic
 * numbers without a database.
 */
export async function readSides(): Promise<Record<"like" | "pass", Side>> {
  const [rows, cats] = await Promise.all([
    sql<AggRow[]>`
      SELECT d.verdict,
             count(*)::int                       AS n,
             avg(t.letters)::float8              AS letters_mean,
             stddev_samp(t.letters)::float8      AS letters_sd,
             avg(t.syllables)::float8            AS syllables_mean,
             stddev_samp(t.syllables)::float8    AS syllables_sd,
             avg(t.hardness)::float8             AS hardness_mean,
             stddev_samp(t.hardness)::float8     AS hardness_sd,
             avg(t.softness)::float8             AS softness_mean,
             stddev_samp(t.softness)::float8     AS softness_sd,
             avg(t.brightness)::float8           AS brightness_mean,
             stddev_samp(t.brightness)::float8   AS brightness_sd,
             count(*) FILTER (WHERE t.ending LIKE 'vowel%')::int AS ends_vowel,
             count(*) FILTER (WHERE t.ending = 'vowel-a')::int   AS ends_a,
             count(*) FILTER (WHERE t.has_double)::int           AS has_double,
             count(*) FILTER (WHERE t.has_cluster)::int          AS has_cluster,
             count(*) FILTER (WHERE t.syllables >= 3)::int       AS long_name
      FROM ${t("decisions")} d
      JOIN ${t("name_traits")} t USING (name_key)
      GROUP BY d.verdict`,
    sql<{ verdict: string; kind: string; key: string; n: number }[]>`
      SELECT d.verdict, 'ending' AS kind, t.ending AS key, count(*)::int AS n
      FROM ${t("decisions")} d JOIN ${t("name_traits")} t USING (name_key)
      GROUP BY d.verdict, t.ending
      UNION ALL
      SELECT d.verdict, 'initial', t.initial, count(*)::int
      FROM ${t("decisions")} d JOIN ${t("name_traits")} t USING (name_key)
      GROUP BY d.verdict, t.initial`,
  ]);

  const out = { like: EMPTY_SIDE(), pass: EMPTY_SIDE() };
  for (const r of rows) {
    const side = r.verdict === "like" ? out.like : out.pass;
    side.n = r.n;
    for (const s of SCALES) {
      side.scales[s] = {
        n: r.n,
        mean: Number(r[`${s}_mean` as keyof AggRow] ?? 0),
        sd: Number(r[`${s}_sd` as keyof AggRow] ?? 0),
      };
    }
    side.flags = {
      endsVowel: r.ends_vowel,
      endsA: r.ends_a,
      hasDouble: r.has_double,
      hasCluster: r.has_cluster,
      longName: r.long_name,
    };
  }
  for (const c of cats) {
    const side = c.verdict === "like" ? out.like : out.pass;
    if (c.kind === "ending") side.endings[c.key as Ending] = c.n;
    else side.initials[c.key] = c.n;
  }
  return out;
}

/* --------------------------------------------------------------- phrasing */

/**
 * Every sentence the card can say, keyed by trait and direction.
 *
 * Templated rather than generated, so the wording is stable, reviewable, and
 * cannot describe a pattern the numbers do not contain.
 */
const SCALE_CLAIMS: Record<Scale, { low: string; high: string; fmt: (v: number) => string }> = {
  letters: {
    low: "You go for short names.",
    high: "You go for longer names.",
    fmt: (v) => `${v.toFixed(1)} letters`,
  },
  syllables: {
    low: "You go for names with fewer syllables.",
    high: "You go for names with more syllables.",
    fmt: (v) => `${v.toFixed(1)} syllables`,
  },
  hardness: {
    low: "Your names are soft — you avoid hard, punchy consonants.",
    high: "Your names are punchy, with hard consonants.",
    fmt: (v) => `${v.toFixed(2)} hard-sound density`,
  },
  softness: {
    low: "You avoid the flowing consonants — l, r, m, n.",
    high: "You lean on flowing consonants — l, r, m, n.",
    fmt: (v) => `${v.toFixed(2)} soft-sound density`,
  },
  brightness: {
    low: "You prefer dark vowels — o and u over e and i.",
    high: "You prefer bright vowels — e and i over o and u.",
    fmt: (v) => `${Math.round(v * 100)}% bright vowels`,
  },
};

const FLAG_CLAIMS: Record<Flag, { more: string; less: string }> = {
  endsVowel: {
    more: "Your names end on a vowel sound.",
    less: "Your names end on a consonant.",
  },
  endsA: {
    more: "A lot of your names end in -a.",
    less: "You steer clear of names ending in -a.",
  },
  hasDouble: {
    more: "You are drawn to doubled letters.",
    less: "You avoid doubled letters.",
  },
  hasCluster: {
    more: "You like a consonant cluster.",
    less: "You avoid consonant clusters.",
  },
  longName: {
    more: "You go for three syllables or more.",
    less: "You almost never pick a name of three syllables or more.",
  },
};

const pct = (k: number, n: number) => `${Math.round((100 * k) / n)}%`;

/* --------------------------------------------------------------- findings */

/**
 * Turn two sides into at most four sentences, or none.
 *
 * Pure: give it numbers, get findings. Everything that decides *whether* to
 * speak lives here, so it can be tested without a database.
 */
export function deriveFindings(like: Side, pass: Side): Finding[] {
  if (like.n < MIN_LIKED || pass.n < MIN_LIKED) return [];
  const found: Finding[] = [];

  for (const s of SCALES) {
    const a = like.scales[s];
    const b = pass.scales[s];
    const z = welchT(a, b);
    const spread = b.sd || 1;
    if (Math.abs(z) < MIN_Z) continue;
    if (Math.abs(a.mean - b.mean) < MIN_SD * spread) continue;
    const claim = SCALE_CLAIMS[s];
    found.push({
      id: s,
      claim: z < 0 ? claim.low : claim.high,
      liked: claim.fmt(a.mean),
      passed: claim.fmt(b.mean),
      z,
    });
  }

  for (const f of FLAGS) {
    const z = proportionZ(like.flags[f], like.n, pass.flags[f], pass.n);
    if (Math.abs(z) < MIN_Z) continue;
    const pA = like.flags[f] / like.n;
    const pB = pass.flags[f] / pass.n;
    const lift = pB === 0 ? Infinity : pA / pB;
    if (lift < MIN_LIFT && lift > 1 / MIN_LIFT) continue;
    found.push({
      id: f,
      claim: z > 0 ? FLAG_CLAIMS[f].more : FLAG_CLAIMS[f].less,
      liked: pct(like.flags[f], like.n),
      passed: pct(pass.flags[f], pass.n),
      z,
    });
  }

  // The strongest initial, when one stands out. Worth its own finding: it is
  // the pattern people are most surprised to be shown about themselves.
  let bestInitial: Finding | null = null;
  for (const [letter, k] of Object.entries(like.initials)) {
    const kB = pass.initials[letter] ?? 0;
    const z = proportionZ(k, like.n, kB, pass.n);
    const lift = kB === 0 ? Infinity : (k / like.n) / (kB / pass.n);
    if (z < MIN_Z || lift < MIN_LIFT) continue;
    if (bestInitial && z <= bestInitial.z) continue;
    bestInitial = {
      id: `initial-${letter}`,
      claim: `${k} of your ${like.n} names start with ${letter.toUpperCase()}.`,
      liked: pct(k, like.n),
      passed: pct(kB, pass.n),
      z,
    };
  }
  if (bestInitial) found.push(bestInitial);

  const strongestFirst = found.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const seen = new Set<string>();
  const distinct: Finding[] = [];
  for (const f of strongestFirst) {
    const family = familyOf(f.id);
    if (seen.has(family)) continue;
    seen.add(family);
    distinct.push(f);
  }
  return distinct.slice(0, MAX_FINDINGS);
}

/**
 * What "more like these" means, numerically.
 *
 * Weighted by |z| from the findings, so the traits that actually separate your
 * likes from your passes are the ones that drive the match. Before the gate
 * opens, a flat prior over shape keeps "best fit" meaningful rather than random.
 */
export function buildProfile(
  like: Side,
  findings: Finding[],
  liked: TasteProfile["liked"],
): TasteProfile | null {
  if (like.n < 5 || liked.length === 0) return null;

  // Every trait counts a little, so a match is judged on the whole shape of a
  // name; the traits that actually separate your likes from your passes count
  // more. Weighting *only* by significance made fit collapse onto one axis —
  // with a single finding, hundreds of names tied at 100% and "best fit"
  // quietly degenerated into A–Z.
  const weights: TasteProfile["weights"] = {
    ending: BASE_WEIGHT,
    // Opening sound, vowel density and doubled letters do not get findings of
    // their own, but they are what separates Alba from Cara — without them the
    // five scales collide outright and hundreds of names tie at a perfect match.
    onset: BASE_WEIGHT,
    vowelRatio: BASE_WEIGHT,
    double: BASE_WEIGHT / 2,
  };
  for (const s of SCALES) weights[s] = BASE_WEIGHT;

  // Capped: an overwhelming z on one trait would otherwise own the ranking
  // outright, and a name matching on that axis alone is not a match.
  const bonus = (z: number) => Math.min(Math.abs(z), MAX_BONUS);
  for (const f of findings) {
    if ((SCALES as readonly string[]).includes(f.id)) {
      weights[f.id as Scale] = BASE_WEIGHT + bonus(f.z);
    } else if (f.id === "endsVowel" || f.id === "endsA") {
      weights.ending = (weights.ending ?? 0) + bonus(f.z);
    }
  }

  const endings: TasteProfile["endings"] = {};
  for (const [k, n] of Object.entries(like.endings)) {
    endings[k as Ending] = n / like.n;
  }

  return { n: like.n, scales: like.scales, endings, weights, liked };
}

/** What an unremarkable trait contributes, before any evidence about it. */
const BASE_WEIGHT = 0.6;
/** The most that being a proven signal can add on top of that. */
const MAX_BONUS = 2;

/**
 * How far apart two names can be on each axis before they stop counting as
 * alike. Tight, because this compares one name to another rather than to the
 * average of a distribution: with ninety reference names, generous tolerances
 * meant almost every candidate found a perfect match somewhere and the ranking
 * collapsed back into alphabetical order.
 */
const MIN_SPREAD: Record<Scale, number> = {
  letters: 0.7,
  syllables: 0.35,
  hardness: 0.045,
  softness: 0.055,
  brightness: 0.16,
};

/** Never let one zero term collapse the whole score to nothing. */
const FLOOR = 0.02;

const valueOf = (t: NameTraits, s: Scale): number =>
  s === "letters" ? t.letters : s === "syllables" ? t.syllables : t[s];

/**
 * How alike two names are, 0–1.
 *
 * A geometric mean, not an arithmetic one: "like this name" should mean close
 * on every axis, so one bad mismatch has to cost real ground. Averaging lets a
 * name that is wrong in exactly one way still score in the eighties, which is
 * how a ranked list fills up with near-misses.
 */
function similarity(
  a: NameTraits,
  b: NameTraits,
  weights: TasteProfile["weights"],
): number {
  let logSum = 0;
  let weight = 0;

  const term = (w: number | undefined, value: number) => {
    if (!w) return;
    logSum += w * Math.log(Math.max(value, FLOOR));
    weight += w;
  };

  for (const s of SCALES) {
    // Compared against the other name, with the spread as the tolerance.
    term(weights[s], closeness(valueOf(a, s), { n: 1, mean: valueOf(b, s), sd: 0 }, MIN_SPREAD[s]));
  }

  const sameEnding = a.ending === b.ending;
  const bothVowel = a.ending.startsWith("vowel") === b.ending.startsWith("vowel");
  term(weights.ending, sameEnding ? 1 : bothVowel ? 0.5 : 0.15);
  term(weights.onset, a.onset === b.onset ? 1 : 0.45);
  term(weights.vowelRatio, closeness(a.vowelRatio, { n: 1, mean: b.vowelRatio, sd: 0 }, 0.09));
  term(weights.double, a.hasDouble === b.hasDouble ? 1 : 0.5);

  return weight === 0 ? 0 : Math.exp(logSum / weight);
}

export interface Fit {
  /** 0–1 against the closest name on the shortlist. */
  score: number;
  /** Which name that was, so a suggestion can say what it takes after. */
  like: string;
}

/** The liked name a candidate is closest to, and how close. */
export function fitScore(traits: NameTraits, p: TasteProfile): Fit | null {
  let best: Fit | null = null;
  for (const l of p.liked) {
    const score = similarity(traits, l.traits, p.weights);
    if (!best || score > best.score) best = { score, like: l.display };
  }
  return best;
}

/**
 * The liked names themselves, analysed.
 *
 * Read as spellings and analysed here rather than pulled column-by-column from
 * name_traits: the analyser is the same pure function either way, and this
 * keeps the heavy work — the aggregation above — as the table's job.
 */
async function readLikedNames(): Promise<TasteProfile["liked"]> {
  const rows = await sql<{ display: string; origin: string | null }[]>`
    SELECT display, origin FROM ${t("decisions")} WHERE verdict = 'like'`;
  return rows.map((r) => ({
    display: r.display,
    traits: analyse(r.display, r.origin),
  }));
}

/** Everything the shortlist card and the name browser need. */
export async function readTaste(): Promise<Taste> {
  const [sides, liked] = await Promise.all([readSides(), readLikedNames()]);
  const findings = deriveFindings(sides.like, sides.pass);
  return {
    sample: { liked: sides.like.n, passed: sides.pass.n },
    findings,
    profile: buildProfile(sides.like, findings, liked),
  };
}
