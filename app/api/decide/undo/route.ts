import { NextResponse } from "next/server";
import { undoLast } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function POST() {
  const restored = await undoLast();
  return NextResponse.json({ ok: true, restored });
}
