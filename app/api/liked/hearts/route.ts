import { NextResponse } from "next/server";
import { setHearts } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let nameKey: unknown;
  let hearts: unknown;
  try {
    ({ name_key: nameKey, hearts } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof nameKey !== "string" || !nameKey) {
    return NextResponse.json({ error: "missing name_key" }, { status: 400 });
  }
  if (typeof hearts !== "number" || !Number.isFinite(hearts)) {
    return NextResponse.json({ error: "bad hearts" }, { status: 400 });
  }
  // setHearts clamps; out-of-range is a client bug, not a rejection worth
  // surfacing mid-gesture.
  await setHearts(nameKey, hearts);
  return NextResponse.json({ ok: true });
}
