import { NextResponse } from "next/server";
import {
  browseNames,
  DEFAULT_QUERY,
  originOptions,
  type BrowseQuery,
  type SortKey,
} from "@/lib/browse";
import { readTaste } from "@/lib/insights";
import type { Gender } from "@/lib/types";

export const dynamic = "force-dynamic";

const GENDERS = ["all", "girl", "boy", "neutral"];
const SYLLABLES = ["any", "1", "2", "3+"];
const FEELS = ["any", "soft", "hard"];
const SORTS: SortKey[] = ["fit", "az", "short", "long"];
/** The most rows one request will return; the browser pages up to this. */
export const MAX_LIMIT = 500;

const ENDINGS = [
  "any", "vowel", "consonant",
  "vowel-a", "vowel-e", "vowel-i", "vowel-o", "vowel-u",
  "nasal", "liquid", "sibilant", "stop", "fricative",
];

/** One of `allowed`, or the fallback. Never trusts the query string. */
function pick<T extends string>(raw: string | null, allowed: readonly string[], fallback: T): T {
  return raw && allowed.includes(raw) ? (raw as T) : fallback;
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;

  const query: BrowseQuery = {
    ...DEFAULT_QUERY,
    q: (p.get("q") ?? "").trim().slice(0, 40),
    gender: pick<"all" | Gender>(p.get("gender"), GENDERS, "all"),
    syllables: pick<BrowseQuery["syllables"]>(p.get("syllables"), SYLLABLES, "any"),
    ending: pick<BrowseQuery["ending"]>(p.get("ending"), ENDINGS, "any"),
    feel: pick<BrowseQuery["feel"]>(p.get("feel"), FEELS, "any"),
    origin: p.get("origin") || null,
    hideSeen: p.get("hideSeen") === "1",
    sort: pick<SortKey>(p.get("sort"), SORTS, "az"),
    limit: Math.min(Math.max(Number(p.get("limit")) || 60, 1), MAX_LIMIT),
    offset: Math.max(Number(p.get("offset")) || 0, 0),
  };

  // The taste profile is rebuilt server-side each request rather than passed
  // in, so "best fit" always reflects the shortlist as it stands right now.
  const { profile, sample } = await readTaste();
  const { names, total } = await browseNames(query, profile);

  return NextResponse.json({
    names,
    total,
    origins: originOptions(),
    /** Whether "best fit" has anything behind it yet. */
    hasTaste: profile !== null,
    likedCount: sample.liked,
  });
}
