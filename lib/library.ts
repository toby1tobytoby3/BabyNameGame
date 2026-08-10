import rawLibrary from "../data/library.json" with { type: "json" };
import { nameKey } from "./nameKey.ts";
import type { Candidate, LibraryEntry } from "./types.ts";

const entries = rawLibrary as LibraryEntry[];

export const LIBRARY: Candidate[] = entries.map((e) => ({
  name_key: nameKey(e.display),
  display: e.display,
  gender: e.gender,
  origin: e.origin,
  tags: e.tags ?? [],
  source: "library" as const,
}));

export const LIBRARY_ORIGINS: string[] = [
  ...new Set(entries.map((e) => e.origin)),
].sort();

/**
 * Tags that carry independent style signal. 24 of the library's 30 tags are
 * just lowercase echoes of the origin field, so counting them would double-count
 * origin preference. Only these six say something origin doesn't.
 */
export const STYLE_TAGS = new Set([
  "short",
  "nickname",
  "vintage",
  "nature",
  "unisex",
  "doubled-sound",
]);
