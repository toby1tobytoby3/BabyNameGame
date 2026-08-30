import assert from "node:assert/strict";
import { test } from "node:test";
import { analyse } from "./analyse.ts";
import {
  buildProfile,
  deriveFindings,
  fitScore,
  FLAGS,
  MIN_LIKED,
  SCALES,
  type Side,
} from "./insights.ts";
import { summarise } from "./stats.ts";

/**
 * Build a Side the way the SQL in readSides does, so the pure logic can be
 * tested against realistic distributions without a database. The two have to
 * agree on what each column means — that correspondence is the one thing this
 * helper cannot check, and is why the aggregate query is kept simple enough to
 * read against this.
 */
const vectorsOf = (displays: string[], origin = "English") =>
  displays.map((d) => ({ display: d, traits: analyse(d, origin) }));

function sideOf(displays: string[], origin = "English"): Side {
  const traits = displays.map((d) => analyse(d, origin));
  const scales = Object.fromEntries(
    SCALES.map((s) => [s, summarise(traits.map((t) => t[s]))]),
  ) as Side["scales"];

  const flags = Object.fromEntries(FLAGS.map((f) => [f, 0])) as Side["flags"];
  const endings: Side["endings"] = {};
  const initials: Side["initials"] = {};
  for (const t of traits) {
    if (t.ending.startsWith("vowel")) flags.endsVowel++;
    if (t.ending === "vowel-a") flags.endsA++;
    if (t.hasDouble) flags.hasDouble++;
    if (t.hasCluster) flags.hasCluster++;
    if (t.syllables >= 3) flags.longName++;
    endings[t.ending] = (endings[t.ending] ?? 0) + 1;
    initials[t.initial] = (initials[t.initial] ?? 0) + 1;
  }
  return { n: traits.length, scales, flags, endings, initials };
}

/** Short, soft, vowel-final — the shape of a real shortlist. No S initials. */
const SOFT = [
  "Cleo", "Nina", "Aela", "Leila", "Effie", "Freya", "Arlo", "Ole",
  "Cara", "Rana", "Maeve", "Eli", "Cato", "Ezra", "Rumi", "Hana", "Mateo",
  "Naya", "Kira", "Alma", "Elke", "Mere", "Leia", "Gaia",
  "Cora", "Kesi", "Luca", "Gala", "Taro", "Hiro", "Renzo", "Marlo",
  "Elio", "Remy", "Nano", "Lila", "Mila", "Otto", "Ivo", "Nell",
  "Rafa", "Tova", "Ada", "Emi", "Kai", "Noa", "Bo", "Ari",
  "Reza", "Milo", "Vera", "Cleo", "Lena", "Nico", "Tara", "Elia",
  "Amara", "Uma", "Iris", "Rhea",
];

/** Even and odd halves of one pool: alike by construction. */
const half = (pool: string[], parity: 0 | 1) =>
  pool.filter((_, i) => i % 2 === parity);

/** Long, hard, consonant-final — a contrasting pool. */
const HARD = [
  "Bartholomew", "Reginald", "Alexander", "Frederick", "Archibald",
  "Cuthbert", "Percival", "Sigismund", "Baldrick", "Gottfried",
  "Wolfgang", "Kendrick", "Roderick", "Wendell", "Aldrich",
  "Bertrand", "Godwin", "Hubert", "Conrad", "Egbert",
  "Osgood", "Rickard", "Tancred", "Ludwig", "Wilfred",
  "Gerhardt", "Dietrich", "Manfred", "Norbert", "Otmar",
];

test("says nothing at all below the sample gate", () => {
  const like = sideOf(SOFT.slice(0, MIN_LIKED - 1));
  const pass = sideOf(HARD);
  assert.deepEqual(deriveFindings(like, pass), []);
});

test("says nothing when the two sides look the same", () => {
  // Interleaved halves, not sliced ones — a pool written roughly in order of
  // length would otherwise plant an effect the test is meant to rule out.
  const findings = deriveFindings(sideOf(half(SOFT, 0)), sideOf(half(SOFT, 1)));
  assert.deepEqual(findings, [], findings.map((f) => f.claim).join(" / "));
});

test("finds a planted effect, in the right direction", () => {
  const findings = deriveFindings(sideOf(SOFT), sideOf(HARD));
  assert.ok(findings.length > 0, "expected findings");

  const ids = findings.map((f) => f.id);
  assert.ok(ids.includes("hardness"), `no hardness finding in ${ids.join(",")}`);

  const hardness = findings.find((f) => f.id === "hardness")!;
  assert.ok(hardness.z < 0, "liked names are the softer ones");
  assert.match(hardness.claim, /soft/);

  // Ranked by strength, and never more than the card can show.
  assert.ok(findings.length <= 4);
  for (let i = 1; i < findings.length; i++) {
    assert.ok(Math.abs(findings[i - 1].z) >= Math.abs(findings[i].z));
  }
});

test("every finding reports both sides", () => {
  for (const f of deriveFindings(sideOf(SOFT), sideOf(HARD))) {
    assert.ok(f.claim.length > 0);
    assert.ok(f.liked.length > 0, `${f.id} has no liked value`);
    assert.ok(f.passed.length > 0, `${f.id} has no passed value`);
  }
});

test("a standout initial is called out with its real count", () => {
  // Both sides are the same kind of name, so the initial is the only signal
  // and has nothing stronger to be crowded out by.
  const sNames = ["Sana", "Suki", "Simi", "Sarai", "Senna", "Suri", "Soren",
    "Sunny", "Saoirse", "Samira", "Sanaa", "Shai", "Sita", "Selma", "Seren"];
  const like = sideOf([...sNames, ...half(SOFT, 0)]);
  const pass = sideOf(half(SOFT, 1));

  const finding = deriveFindings(like, pass).find((f) => f.id.startsWith("initial-"));
  assert.ok(finding, "expected an initial finding");
  assert.match(finding.claim, /start with S/);
  assert.match(finding.claim, new RegExp(`${sNames.length} of your ${like.n}`));
});

test("one finding per family — the card never says 'short' three ways", () => {
  const findings = deriveFindings(sideOf(SOFT), sideOf(HARD));
  const families = findings.map((f) =>
    ["letters", "syllables", "longName"].includes(f.id) ? "length"
      : ["hardness", "softness", "hasCluster"].includes(f.id) ? "sound"
      : ["endsVowel", "endsA"].includes(f.id) ? "ending"
      : f.id,
  );
  assert.equal(new Set(families).size, families.length, families.join(","));
});

test("fit ranks names that look like the liked ones above ones that do not", () => {
  const like = sideOf(SOFT);
  const profile = buildProfile(like, deriveFindings(like, sideOf(HARD)), vectorsOf(SOFT));
  assert.ok(profile, "expected a profile");

  const near = fitScore(analyse("Talia", "Italian"), profile)!;
  const far = fitScore(analyse("Bartholomew", "English"), profile)!;
  assert.ok(
    near.score > far.score,
    `Talia ${near.score.toFixed(3)} should beat Bartholomew ${far.score.toFixed(3)}`,
  );
  for (const v of [near, far]) assert.ok(v.score >= 0 && v.score <= 1, "fit stays in range");
  // A suggestion says which of your names it takes after, and means it.
  assert.ok(SOFT.includes(near.like), `${near.like} should be a liked name`);
});

test("fit still works before there is enough evidence to speak", () => {
  // Six likes: no findings, but "best fit" must still mean something.
  const like = sideOf(SOFT.slice(0, 6));
  const profile = buildProfile(like, [], vectorsOf(SOFT.slice(0, 6)));
  assert.ok(profile, "expected a fallback profile");
  // Every trait carries its base weight even with nothing proven about it, so
  // fit reflects the whole shape of a name rather than one axis.
  assert.deepEqual(Object.keys(profile.weights).sort(), [
    "brightness", "double", "ending", "hardness", "letters",
    "onset", "softness", "syllables", "vowelRatio",
  ]);
  assert.ok(
    fitScore(analyse("Nia", "English"), profile)!.score >
      fitScore(analyse("Archibald", "English"), profile)!.score,
  );
});

test("no profile at all from almost nothing", () => {
  assert.equal(buildProfile(sideOf(SOFT.slice(0, 3)), [], vectorsOf(SOFT.slice(0, 3))), null);
});
