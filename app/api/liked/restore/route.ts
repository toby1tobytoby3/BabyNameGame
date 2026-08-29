import { NextResponse } from "next/server";
import { relike } from "@/lib/queue";

export const dynamic = "force-dynamic";

/** Undo for a swipe-to-remove. Puts the name back at the rank it held. */
export async function POST(req: Request) {
  let nameKey: unknown;
  let rank: unknown;
  try {
    ({ name_key: nameKey, rank } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof nameKey !== "string" || !nameKey) {
    return NextResponse.json({ error: "missing name_key" }, { status: 400 });
  }
  const at =
    typeof rank === "number" && Number.isFinite(rank)
      ? Math.trunc(rank)
      : null;
  await relike(nameKey, at);
  return NextResponse.json({ ok: true });
}
