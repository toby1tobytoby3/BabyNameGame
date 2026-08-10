import { NextResponse } from "next/server";
import { getLiked } from "@/lib/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ names: await getLiked() });
}
