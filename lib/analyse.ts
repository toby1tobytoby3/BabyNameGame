import { nameKey } from "./nameKey.ts";

/**
 * Bump when the analysis changes. Rows carry the version they were written
 * with, so a re-analysis is "UPDATE where analysed_with < ANALYSER_VERSION"
 * rather than a migration. The traits table is a cache, never a source of
 * truth: every value here is a pure function of the display string.
 */
export const ANALYSER_VERSION = 1;

export type Onset =
  | "vowel" | "stop" | "nasal" | "liquid" | "sibilant" | "fricative" | "glide";

/** Ending sound. Vowel finals are split by vowel — -a and -o carry real signal. */
export type Ending =
  | "vowel-a" | "vowel-e" | "vowel-i" | "vowel-o" | "vowel-u"
  | "nasal" | "liquid" | "sibilant" | "stop" | "fricative";

export interface NameTraits {
  /** Letters after folding — Mary-Jane is 8, not 9. */
  letters: number;
  syllables: number;
  onset: Onset;
  ending: Ending;
  /** Plosive density, 0–1. The "harshness" axis: Kit 0.67, Aoife 0.0. */
  hardness: number;
  /** Sonorant (l r m n w y) density, 0–1. */
  softness: number;
  /** Share of front vowels among all vowels, 0–1. Bright (Effie) vs dark (Otto). */
  brightness: number;
  vowelRatio: number;
  hasDouble: boolean;
  hasCluster: boolean;
  /** First folded letter, for alliteration against a surname. */
  initial: string;
}

const PLOSIVES = new Set(["p", "b", "t", "d", "k", "g", "c", "q", "x"]);
/**
 * Built from PLOSIVES rather than written out again. The two had drifted apart
 * in an earlier draft — the cluster test was missing `c`, so Hector read as
 * smooth while its hardness said otherwise.
 */
const PLOSIVE_CLASS = [...PLOSIVES].join("");
const CLUSTER = new RegExp(
  `[^aeiouy]{3}|([${PLOSIVE_CLASS}])(?!\\1)[${PLOSIVE_CLASS}]`,
);
const NASALS = new Set(["m", "n"]);
const LIQUIDS = new Set(["l", "r"]);
const SIBILANTS = new Set(["s", "z", "j"]);
const GLIDES = new Set(["w", "y"]);
const SONORANTS = new Set(["l", "r", "m", "n", "w", "y"]);
const VOWELS = new Set(["a", "e", "i", "o", "u"]);
/** Front vowels. 'a' is central and counts for neither side. */
const FRONT = new Set(["e", "i", "y"]);
const BACK = new Set(["o", "u"]);

/**
 * Vowel pairs that make one nucleus. Chosen by ablation against CMUdict and a
 * hand-labelled set (see analyse.test.ts) — every entry earns its place; the
 * ones that looked plausible but scored worse (a palatalising -tia-/-gia- rule,
 * treating y-before-a-vowel as a consonant) are deliberately absent.
 */
const DIPHTHONGS = new Set([
  "ai", "ay", "au", "aw", "ao", "ea", "ee", "ei", "ey", "eu",
  "ie", "oa", "oi", "oo", "ou", "ow", "oy", "ue", "ui",
]);

/** Origins whose names do not take the English silent final -e. */
const VOWEL_FINAL =
  /japanese|hawaiian|maori|italian|nguni|swahili|yoruba|turkish|indian/i;

/** Consonants after which a final -le keeps its own syllable (Maple, not Camille). */
const SYLLABIC_LE_AFTER = new Set(["p", "b", "t", "d", "k", "g", "f", "c"]);

function isVowel(s: string, i: number): boolean {
  const ch = s[i];
  if (VOWELS.has(ch)) return true;
  // Leading y before a vowel is a consonant (Yara); elsewhere it is a vowel.
  return ch === "y" && !(i === 0 && VOWELS.has(s[1] ?? ""));
}

/**
 * Syllable count from spelling alone.
 *
 * Measured at ~90% exact and 99.8% within one syllable across 1,090 names
 * (CMUdict where it has an entry, hand-labelled elsewhere). Good enough for
 * aggregates and comparisons; treat a single name's count as approximate.
 */
export function countSyllables(display: string, origin?: string | null): number {
  let s = nameKey(display);
  if (!s) return 0;

  // Silent final -e, English-style, also under a final -s (Miles, Jules).
  if (!(origin && VOWEL_FINAL.test(origin))) {
    const core = s.endsWith("s") ? s.slice(0, -1) : s;
    const syllabicLe =
      core.endsWith("le") && SYLLABIC_LE_AFTER.has(core[core.length - 3] ?? "");
    if (
      core.length > 2 &&
      core.endsWith("e") &&
      !isVowel(core, core.length - 2) &&
      !syllabicLe
    ) {
      s = core.slice(0, -1);
    }
  }

  let count = 0;
  let i = 0;
  while (i < s.length) {
    // qu is a cluster, not a nucleus: Quinn, Queenie.
    if (s[i] === "q" && s[i + 1] === "u") {
      i += 2;
      continue;
    }
    if (!isVowel(s, i)) {
      i++;
      continue;
    }

    let j = i;
    while (j < s.length && isVowel(s, j)) j++;
    const run = s.slice(i, j);
    // A run ending the name (or ending before a final -s) behaves differently:
    // Greek and Latin names break there — Anthea, Rhea, Andreas, Orpheus.
    const runEndsWord = j >= s.length || (j === s.length - 1 && s[j] === "s");

    let k = 0;
    while (k < run.length) {
      const pair = run.slice(k, k + 2);
      if (pair.length === 2) {
        if (
          pair[0] === "e" &&
          "aou".includes(pair[1]) &&
          runEndsWord &&
          k + 2 >= run.length
        ) {
          count += 2;
          k += 2;
          continue;
        }
        // Medial -ie- is two sounds: Damien, Juliette, Olivier.
        if (pair === "ie" && !runEndsWord) {
          count += 2;
          k += 2;
          continue;
        }
        // A doubled vowel is one long sound: Aarav, Noor, Ataahua.
        if (pair[0] === pair[1]) {
          count++;
          k += 2;
          continue;
        }
        if (DIPHTHONGS.has(pair)) {
          count++;
          k += 2;
          continue;
        }
      }
      count++;
      k++;
    }
    i = j;
  }
  return Math.max(count, 1);
}

/** Opening digraphs, so Theo is not filed as a hard T. Mirrors endingOf. */
const ONSET_DIGRAPHS: Record<string, Onset> = {
  th: "fricative", ph: "fricative", wh: "glide",
  sh: "sibilant", ch: "sibilant", gh: "fricative",
};

function classify(ch: string): Onset {
  if (VOWELS.has(ch)) return "vowel";
  if (PLOSIVES.has(ch)) return "stop";
  if (NASALS.has(ch)) return "nasal";
  if (LIQUIDS.has(ch)) return "liquid";
  if (SIBILANTS.has(ch)) return "sibilant";
  if (GLIDES.has(ch)) return "glide";
  return "fricative"; // f v h w th ph gh
}

/**
 * What a name *ends on*, by sound rather than by letter.
 *
 * The letter alone is wrong often enough to matter: Sarah, Willow and Godfrey
 * all end on a vowel sound while ending on h, w and y. 32 library names ride on
 * these rules, and the "ends on a vowel" share is one of the strongest signals
 * in the data, so it is worth getting right.
 */
function endingOf(s: string): Ending {
  const last = s[s.length - 1];
  const prev = s[s.length - 2] ?? "";

  // -ie and -ee close on /i/, not on the written e: Effie, Florrie, Dee.
  if (last === "e" && (prev === "i" || prev === "e")) return "vowel-i";
  if (VOWELS.has(last)) return `vowel-${last}` as Ending;

  if (last === "h" || last === "w" || last === "y") {
    if (VOWELS.has(prev)) {
      // -ew and -uw close on /uː/; -ey and -uy on /i/; otherwise the written
      // vowel is the sound you hear: Sarah, Willow, Qusay, Roy.
      if (last === "w") return prev === "e" || prev === "u" ? "vowel-u" : "vowel-o";
      if (last === "y") return prev === "e" || prev === "u" ? "vowel-i" : (`vowel-${prev}` as Ending);
      return `vowel-${prev}` as Ending;
    }
    // Final y after a consonant is the /i/ of Posy and Remy.
    if (last === "y") return "vowel-i";
    // sh and ch are sibilants; th, ph and gh are not.
    if (last === "h") return prev === "s" || prev === "c" ? "sibilant" : "fricative";
    return "fricative";
  }

  const cls = classify(last);
  return cls === "vowel" || cls === "glide" ? "fricative" : cls;
}

/**
 * Everything we can know about a name from its spelling.
 *
 * `origin` is a hint, not a component of identity: it only decides whether the
 * English silent-e rule applies, and traits stay keyed on name_key.
 */
export function analyse(display: string, origin?: string | null): NameTraits {
  const s = nameKey(display);
  if (!s) {
    return {
      letters: 0, syllables: 0, onset: "vowel", ending: "vowel-a",
      hardness: 0, softness: 0, brightness: 0, vowelRatio: 0,
      hasDouble: false, hasCluster: false, initial: "",
    };
  }

  const chars = [...s];
  const vowels = chars.filter((c) => VOWELS.has(c) || c === "y");
  const front = vowels.filter((c) => FRONT.has(c)).length;
  const back = vowels.filter((c) => BACK.has(c)).length;

  const round = (n: number) => Math.round(n * 1000) / 1000;

  return {
    letters: chars.length,
    syllables: countSyllables(display, origin),
    onset: ONSET_DIGRAPHS[s.slice(0, 2)] ?? classify(chars[0]),
    ending: endingOf(s),
    hardness: round(chars.filter((c) => PLOSIVES.has(c)).length / chars.length),
    softness: round(chars.filter((c) => SONORANTS.has(c)).length / chars.length),
    // Half when a name is all central vowels, so the axis has a real middle.
    brightness: front + back === 0 ? 0.5 : round(front / (front + back)),
    vowelRatio: round(vowels.length / chars.length),
    hasDouble: /(.)\1/.test(s),
    // Three consonants, or two *different* plosives back to back. A doubled
    // letter is one long sound, not a cluster — Otto and Pippa are smooth.
    hasCluster: CLUSTER.test(s),
    initial: chars[0],
  };
}
