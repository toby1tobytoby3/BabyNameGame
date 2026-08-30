import { NextResponse } from "next/server";
import { readTaste } from "@/lib/insights";

export const dynamic = "force-dynamic";

/** What your likes have in common, and how sure we are. Read-only. */
export async function GET() {
  const { sample, findings } = await readTaste();
  // The profile is deliberately not returned: it is a scoring input, not
  // something the client has any use for, and keeping it server-side means
  // nobody can hand us a made-up one.
  return NextResponse.json({ sample, findings });
}
