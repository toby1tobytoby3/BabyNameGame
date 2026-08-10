import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTopUp } from "./generate.ts";
import { LIBRARY } from "./library.ts";
import { buildProfile } from "./profile.ts";
import { DEFAULT_PREFERENCES, type Decision, type Preferences } from "./types.ts";

function liked(displays: string[]): Decision[] {
  return displays.map((display, i) => {
    const found = LIBRARY.find((c) => c.display === display);
    if (!found) throw new Error(`not in library: ${display}`);
    return {
      ...found,
      verdict: "like" as const,
      rank: i + 1,
      decided_at: new Date().toISOString(),
    };
  });
}

const prefs: Preferences = { ...DEFAULT_PREFERENCES };

test("fills the requested count from the library alone", async () => {
  const profile = buildProfile([], prefs);
  const { candidates, meta } = await buildTopUp({
    gender: "girl",
    count: 60,
    liked: [],
    recentPasses: [],
    prefs,
    profile,
    excluded: new Set(),
    allowAi: false,
  });

  assert.equal(candidates.length, 60);
  assert.equal(meta.short, false);
  // No AI key and allowAi:false — everything must come from the library.
  assert.equal(meta.fromAi, 0);
});

test("never returns an excluded name — the never-repeat guarantee", async () => {
  const profile = buildProfile([], prefs);
  // Exclude all but 40 of the eligible girl names.
  const eligible = LIBRARY.filter(
    (c) => c.gender === "girl" || c.gender === "neutral",
  );
  const keep = new Set(eligible.slice(0, 40).map((c) => c.name_key));
  const excluded = new Set(
    LIBRARY.filter((c) => !keep.has(c.name_key)).map((c) => c.name_key),
  );

  const { candidates, meta } = await buildTopUp({
    gender: "girl",
    count: 60,
    liked: [],
    recentPasses: [],
    prefs,
    profile,
    excluded,
    allowAi: false,
  });

  for (const c of candidates) {
    assert.ok(!excluded.has(c.name_key), `leaked excluded name ${c.display}`);
  }
  // Coming up short is a valid outcome, not an error.
  assert.equal(candidates.length, 40);
  assert.equal(meta.short, true);
});

test("returns no duplicates within a chunk", async () => {
  const profile = buildProfile([], prefs);
  const { candidates } = await buildTopUp({
    gender: "boy",
    count: 60,
    liked: [],
    recentPasses: [],
    prefs,
    profile,
    excluded: new Set(),
    allowAi: false,
  });
  const keys = new Set(candidates.map((c) => c.name_key));
  assert.equal(keys.size, candidates.length);
});

test("respects a hard origin filter", async () => {
  const hardPrefs: Preferences = {
    ...DEFAULT_PREFERENCES,
    origin_mode: "hard",
    origins: [{ origin: "Irish", weight: 3 }],
  };
  const profile = buildProfile([], hardPrefs);
  const { candidates } = await buildTopUp({
    gender: "girl",
    count: 40,
    liked: [],
    recentPasses: [],
    prefs: hardPrefs,
    profile,
    excluded: new Set(),
    allowAi: false,
  });
  assert.ok(candidates.length > 0);
  for (const c of candidates) assert.equal(c.origin, "Irish");
});

/**
 * Sampling is deliberately stochastic, so a single draw is far too noisy to
 * assert on — an earlier single-draw version of these tests failed ~40% of runs.
 * Averaging over trials cuts the standard error by √trials and makes the
 * assertion mean what it says.
 */
async function meanShare(
  origin: string,
  profile: ReturnType<typeof buildProfile>,
  excluded: Set<string>,
  trials = 25,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < trials; i++) {
    const { candidates } = await buildTopUp({
      gender: "girl",
      count: 100,
      liked: [],
      recentPasses: [],
      prefs,
      profile,
      excluded,
      allowAi: false,
    });
    total +=
      candidates.filter((c) => c.origin === origin).length / candidates.length;
  }
  return total / trials;
}

function libraryShare(origin: string): number {
  const girls = LIBRARY.filter((c) => c.gender === "girl");
  return girls.filter((c) => c.origin === origin).length / girls.length;
}

test("liked names bias the sample towards their origin", async () => {
  const irish = LIBRARY.filter(
    (c) => c.origin === "Irish" && c.gender === "girl",
  ).slice(0, 12);
  const profile = buildProfile(liked(irish.map((c) => c.display)), prefs);
  const excluded = new Set(irish.map((c) => c.name_key));

  const share = await meanShare("Irish", profile, excluded);
  const baseline = libraryShare("Irish");

  // Measured lift from 12 likes averages ~2.1x baseline. Assert a floor the
  // effect clears comfortably rather than one sitting on the mean — the latter
  // fails half the time no matter how good the code is.
  assert.ok(
    share > baseline * 1.75,
    `Irish ${(share * 100).toFixed(1)}% should clearly exceed the ${(baseline * 100).toFixed(1)}% baseline`,
  );
  // ...but not collapse into monotony. Exploration has to survive.
  assert.ok(
    share < 0.6,
    `Irish ${(share * 100).toFixed(1)}% is crowding everything else out`,
  );
});

test("a single like nudges but does not dominate", async () => {
  // Confidence shrinkage: one observation must not reshape the whole queue.
  const one = LIBRARY.find(
    (c) => c.origin === "Hawaiian" && c.gender === "girl",
  )!;
  const profile = buildProfile(liked([one.display]), prefs);

  const share = await meanShare(
    "Hawaiian",
    profile,
    new Set([one.name_key]),
  );
  const baseline = libraryShare("Hawaiian");

  assert.ok(
    share < baseline * 2,
    `one like pushed Hawaiian to ${(share * 100).toFixed(1)}% vs a ${(baseline * 100).toFixed(1)}% baseline — too eager`,
  );
});
