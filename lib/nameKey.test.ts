import assert from "node:assert/strict";
import { test } from "node:test";
import rawLibrary from "../data/library.json" with { type: "json" };
import { nameKey } from "./nameKey.ts";

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
