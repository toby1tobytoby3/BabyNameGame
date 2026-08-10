/**
 * Normalised key for a name. This is the backbone of the never-repeat
 * guarantee: every dedupe and exclusion check compares on the output of this
 * function, never on display text.
 *
 * NFD + combining-mark stripping alone is NOT enough. Characters that need the
 * explicit fold map below, all of which appear in data/library.json:
 *   - ʻ  U+02BB MODIFIER LETTER TURNED COMMA (Hawaiian okina) — a letter, not a
 *        combining mark, so \p{M} leaves it untouched.  Naʻea, Nauʻe
 *   - ø  no canonical decomposition, so NFD is a no-op.     Vebjørn, Frøya
 * Order matters: the fold map runs after toLowerCase().
 */
export function nameKey(display: string): string {
  return display
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // Gobán→Goban, Åke→Ake, Rüzgar→Ruzgar, Zoë→Zoe
    .toLowerCase()
    .replace(/[ʻʼ'‘’`´]/gu, "") // okina + apostrophes
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ß/g, "ss")
    .replace(/[đð]/g, "d")
    .replace(/ł/g, "l")
    .replace(/þ/g, "th")
    .replace(/[^a-z]/g, "") // drops hyphens and spaces: Mary-Jane→maryjane
    .trim();
}
