import { after, NextResponse } from "next/server";
import {
  getPreferences,
  queueDepth,
  readQueue,
  topUpGender,
} from "@/lib/queue";
import type { GenderFilter } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const genderParam = url.searchParams.get("gender") ?? "all";
  const gender: GenderFilter = ["all", "girl", "boy"].includes(genderParam)
    ? (genderParam as GenderFilter)
    : "all";
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 25), 1),
    100,
  );

  const [prefs, depth] = await Promise.all([getPreferences(), queueDepth()]);

  const low = (["girl", "boy"] as const).filter(
    (g) => depth[g] <= prefs.topup_threshold,
  );
  const empty = (["girl", "boy"] as const).filter((g) => depth[g] === 0);

  // Nothing to serve at all → block on generation so the user sees cards
  // rather than an empty screen.
  const mustBlock =
    gender === "all"
      ? empty.length === 2
      : empty.includes(gender as "girl" | "boy");

  if (mustBlock) {
    for (const g of empty) await topUpGender(g, { allowAi: true });
  }

  const names = await readQueue(gender, limit);

  // Otherwise refill in the background: the response goes out immediately and
  // the (slow) AI call happens after it.
  if (!mustBlock && low.length) {
    after(async () => {
      for (const g of low) {
        try {
          await topUpGender(g, { allowAi: true });
        } catch (err) {
          console.error("[queue] background top-up failed", g, err);
        }
      }
    });
  }

  return NextResponse.json({
    names,
    depth,
    exhausted: names.length === 0,
  });
}
