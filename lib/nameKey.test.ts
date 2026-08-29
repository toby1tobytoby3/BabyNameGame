import assert from "node:assert/strict";
import { test } from "node:test";
import rawLibrary from "../data/library.json" with { type: "json" };
import { nameKey, tidyDisplay } from "./nameKey.ts";

test("lowercases and trims", () => {
  assert.equal(nameKey("  Saoirse "), "saoirse");
  assert.equal(nameKey("AOIFE"), "aoife");
});

test("strips combining marks", () => {
  assert.equal(nameKey("Zoë"), "zoe");
  assert.equal(nameKey("Gobán"), "goban");
  assert.equal(nameKey("Åke"), "ake");
  assert.equal(nameKey("Rüzgar"), "ruzgar");
});

test("folds characters NFD alone would miss", () => {
  // ø has no canonical decomposition — NFD is a no-op on it.
  assert.equal(nameKey("Vebjørn"), "vebjorn");
  assert.equal(nameKey("Frøya"), "froya");
  // U+02BB okina is a modifier *letter*, so \p{M} never touches it.
  assert.equal(nameKey("Naʻea"), "naea");
  assert.equal(nameKey("Nauʻe"), "naue");
  assert.equal(nameKey("Æsa"), "aesa");
  assert.equal(nameKey("Straße"), "strasse");
});

test("collapses the variants that must not both appear", () => {
  assert.equal(nameKey("Vebjørn"), nameKey("Vebjorn"));
  assert.equal(nameKey("Zoë"), nameKey("Zoe"));
  assert.equal(nameKey("Naʻea"), nameKey("Naea"));
  assert.equal(nameKey("Mary-Jane"), nameKey("Mary Jane"));
});

test("every library name yields a non-empty key", () => {
  const lib = rawLibrary as { display: string }[];
  for (const entry of lib) {
    assert.ok(
      nameKey(entry.display).length > 0,
      `empty key for ${entry.display}`,
    );
  }
});

test("library has no colliding keys", () => {
  const lib = rawLibrary as { display: string }[];
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const entry of lib) {
    const key = nameKey(entry.display);
    const prev = seen.get(key);
    if (prev) collisions.push(`${prev} ≡ ${entry.display} (${key})`);
    else seen.set(key, entry.display);
  }
  assert.deepEqual(collisions, []);
  assert.equal(seen.size, lib.length);
});

test("tidyDisplay fixes the two ways people type, and no others", () => {
  assert.equal(tidyDisplay("  otto "), "Otto");
  assert.equal(tidyDisplay("MARY-JANE"), "Mary-Jane");
  assert.equal(tidyDisplay("mary  jane"), "Mary Jane");
  assert.equal(tidyDisplay("o'brien"), "O'Brien");
  // Deliberate internal capitals survive untouched — no rule gets these right.
  assert.equal(tidyDisplay("McKenna"), "McKenna");
  assert.equal(tidyDisplay("DeAndre"), "DeAndre");
  assert.equal(tidyDisplay(" Saoirse "), "Saoirse");
  // Accented and folded characters keep their form; only the case changes.
  assert.equal(tidyDisplay("vebjørn"), "Vebjørn");
  assert.equal(tidyDisplay("zoë"), "Zoë");
});

test("clampOriginPrefs holds the −2…+2 scale against old and bad data", async () => {
  const { clampOriginPrefs } = await import("./types.ts");
  // Weights from the old 0…5 scale land at the new ceiling rather than
  // scoring off the end of it.
  assert.deepEqual(clampOriginPrefs([{ origin: "Irish", weight: 5 }]), [
    { origin: "Irish", weight: 2 },
  ]);
  assert.deepEqual(clampOriginPrefs([{ origin: "German", weight: -9 }]), [
    { origin: "German", weight: -2 },
  ]);
  // 0 is "no opinion" and is never stored, so it drops out entirely.
  assert.deepEqual(clampOriginPrefs([{ origin: "Greek", weight: 0 }]), []);
  assert.deepEqual(clampOriginPrefs([{ origin: "Greek", weight: 1.4 }]), [
    { origin: "Greek", weight: 1 },
  ]);
  // Shapes a jsonb column can legitimately hand back.
  assert.deepEqual(clampOriginPrefs(null), []);
  assert.deepEqual(clampOriginPrefs("[]"), []);
  assert.deepEqual(clampOriginPrefs([{ origin: "", weight: 2 }]), []);
  assert.deepEqual(clampOriginPrefs([{ weight: 2 }]), []);
  assert.deepEqual(clampOriginPrefs([{ origin: "Irish" }]), []);
  // A duplicated origin would otherwise render two rows for one control.
  assert.deepEqual(
    clampOriginPrefs([
      { origin: "Irish", weight: 2 },
      { origin: "Irish", weight: -1 },
    ]),
    [{ origin: "Irish", weight: 2 }],
  );
});

test("toTags survives the shapes jsonb can actually return", async () => {
  const { toTags } = await import("./types.ts");
  assert.deepEqual(toTags(["short", "vintage"]), ["short", "vintage"]);
  // The double-encoded form that a mis-cast jsonb write produces. Iterating
  // this with for..of would otherwise yield characters, not tags.
  assert.deepEqual(toTags('["short","vintage"]'), ["short", "vintage"]);
  assert.deepEqual(toTags(null), []);
  assert.deepEqual(toTags(undefined), []);
  assert.deepEqual(toTags("not json"), []);
  assert.deepEqual(toTags('{"a":1}'), []);
  assert.deepEqual(toTags([1, "short", null]), ["short"]);
});
