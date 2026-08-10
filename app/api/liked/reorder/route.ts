import { NextResponse } from "next/server";
import { reorderLiked } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let keys: unknown;
  try {
    ({ orderedNameKeys: keys } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  await reorderLiked(keys as string[]);
  return NextResponse.json({ ok: true });
}
