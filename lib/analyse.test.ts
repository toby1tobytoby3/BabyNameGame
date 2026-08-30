import assert from "node:assert/strict";
import { test } from "node:test";
import rawFixture from "./analyse.fixture.json" with { type: "json" };
import rawLibrary from "../data/library.json" with { type: "json" };
import { analyse, countSyllables } from "./analyse.ts";

/**
 * 236 names with a known syllable count.
 *
 * `cmudict` rows are taken from the CMU Pronouncing Dictionary (public domain),
 * which covers 48% of the library — the count is its stress-digit count, so it
 * is exact but reflects *American English* pronunciation. `hand` rows are the
 * other half: names CMUdict has no entry for, labelled by hand across all 24
 * origins, which is the only way to check the heuristic outside English.
 *
 * The rule set in analyse.ts was chosen by ablation against these two sets.
 * Selecting on half and measuring on the held-out half gave 89.8% (cmudict) and
 * 92.7% (hand), against 90.8% / 92.6% for the full sets — so the rules
 * generalise rather than fitting these rows. The floors below sit under the
 * held-out figures, not the fitted ones.
 */
const FIXTURE = rawFixture as [string, string, number, "hand" | "cmudict"][];

test("syllable counts hold their measured accuracy", () => {
  let exact = 0;
  let within1 = 0;
  const misses: string[] = [];
  for (const [display, origin, want] of FIXTURE) {
    const got = countSyllables(display, origin);
    if (got === want) exact++;
    else misses.push(`${display} (${origin}) want ${want} got ${got}`);
    if (Math.abs(got - want) <= 1) within1++;
  }
  const pct = (100 * exact) / FIXTURE.length;
  const pct1 = (100 * within1) / FIXTURE.length;

  // A floor, not a target. If a change pushes this up, raise the floor.
  assert.ok(pct >= 88, `exact ${pct.toFixed(1)}% fell below 88%:\n${misses.join("\n")}`);
  // Being out by more than one syllable is the error that would show, so this
  // floor is the tight one.
  assert.ok(pct1 >= 99, `within-1 ${pct1.toFixed(1)}% fell below 99%`);
});

test("the cases the rules were written for", () => {
  const cases: [string, string | null, number][] = [
    ["Saoirse", "Irish", 2],
    ["Cleo", "English", 2],      // hiatus at the end
    ["Leo", "English", 2],
    ["Quinn", "Modern / International", 1], // qu is a cluster
    ["Queenie", "English", 2],
    ["Miles", "English", 1],     // silent -e under a final -s
    ["Aarav", "Indian (Sanskrit)", 2], // doubled vowel is one sound
    ["Maile", "Hawaiian", 2],    // MAI-le: no English silent -e in Hawaiian
    ["Mere", "Maori", 2],
    ["Jane", "English", 1],
    ["Effie", "English", 2],
    ["Damien", "French", 3],     // medial -ie- splits
    ["Anthea", "Greek", 3],
    ["Alohilani", "Hawaiian", 5],
    ["Bo", null, 1],
  ];
  for (const [display, origin, want] of cases) {
    assert.equal(countSyllables(display, origin), want, `${display}`);
  }
});

test("every library name yields usable traits", () => {
  const lib = rawLibrary as { display: string; origin: string }[];
  for (const entry of lib) {
    const t = analyse(entry.display, entry.origin);
    assert.ok(t.letters > 0, `no letters for ${entry.display}`);
    assert.ok(t.syllables >= 1, `no syllables for ${entry.display}`);
    assert.ok(t.syllables <= t.letters, `more syllables than letters: ${entry.display}`);
    for (const k of ["hardness", "softness", "brightness", "vowelRatio"] as const) {
      assert.ok(t[k] >= 0 && t[k] <= 1, `${k} out of range for ${entry.display}`);
    }
    assert.ok(t.initial.length === 1, `bad initial for ${entry.display}`);
  }
});

test("traits describe the axes they claim to", () => {
  const kit = analyse("Kit", "English");
  const aoife = analyse("Aoife", "Irish");
  assert.ok(kit.hardness > aoife.hardness, "Kit should read harder than Aoife");
  assert.ok(aoife.vowelRatio > kit.vowelRatio);

  assert.equal(analyse("Otto", "Italian").ending, "vowel-o");
  assert.equal(analyse("Cora", "English").ending, "vowel-a");
  assert.equal(analyse("Posy", "English").ending, "vowel-i"); // final y sounds -i
  assert.equal(analyse("Finn", "Scandinavian").ending, "nasal");
  assert.equal(analyse("Pearl", "English").ending, "liquid");
  assert.equal(analyse("Cass", "English").ending, "sibilant");
  assert.equal(analyse("Fred", "English").ending, "stop");

  // Ends on a vowel *sound* despite the final letter.
  assert.equal(analyse("Sarah", "Hebrew").ending, "vowel-a");
  assert.equal(analyse("Noah", "Hebrew").ending, "vowel-a");
  assert.equal(analyse("Willow", "English").ending, "vowel-o");
  assert.equal(analyse("Godfrey", "English").ending, "vowel-i");
  assert.equal(analyse("Qusay", "Arabic").ending, "vowel-a");
  assert.equal(analyse("Roy", "English").ending, "vowel-o");
  assert.equal(analyse("Matthew", "English").ending, "vowel-u");
  // …but a consonant sound stays one.
  assert.equal(analyse("Ruth", "English").ending, "fricative");
  assert.equal(analyse("Yash", "Indian (Sanskrit)").ending, "sibilant");

  assert.equal(analyse("Iris", "Greek").onset, "vowel");
  assert.equal(analyse("Maeve", "Irish").onset, "nasal");
  // Opening digraphs, like the endings.
  assert.equal(analyse("Theo", "Greek").onset, "fricative");
  assert.equal(analyse("Shai", "Hebrew").onset, "sibilant");
  assert.equal(analyse("Teddy", "English").onset, "stop");

  assert.ok(analyse("Effie", "English").hasDouble);
  assert.ok(!analyse("Cora", "English").hasDouble);
  assert.ok(analyse("Astrid", "Scandinavian").hasCluster);
  assert.ok(!analyse("Aela", "Modern / International").hasCluster);
  // A geminate is one long sound, not a cluster.
  assert.ok(!analyse("Otto", "Italian").hasCluster);
  assert.ok(!analyse("Pippa", "English").hasCluster);
  assert.ok(analyse("Hector", "Greek").hasCluster);

  assert.equal(analyse("Effie", "English").ending, "vowel-i");
  assert.equal(analyse("Florrie", "English").ending, "vowel-i");
  assert.equal(analyse("Zoe", "Greek").ending, "vowel-e");

  // Diacritics and hyphens fold the same way name_key does, so traits and key
  // never disagree about what the name is.
  assert.equal(analyse("Zoë").letters, 3);
  assert.equal(analyse("Mary-Jane").letters, 8);
});

test("analysing junk does not throw", () => {
  for (const junk of ["", "  ", "123", "!!", "-"]) {
    const t = analyse(junk);
    assert.equal(t.letters, 0);
    assert.equal(t.syllables, 0);
  }
});
