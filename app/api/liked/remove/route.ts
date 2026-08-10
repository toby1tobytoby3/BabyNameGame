import { NextResponse } from "next/server";
import { unlike } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let nameKey: unknown;
  try {
    ({ name_key: nameKey } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof nameKey !== "string" || !nameKey) {
    return NextResponse.json({ error: "missing name_key" }, { status: 400 });
  }
  await unlike(nameKey);
  return NextResponse.json({ ok: true });
}
