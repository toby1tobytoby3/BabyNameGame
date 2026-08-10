import { NextResponse } from "next/server";
import { decide } from "@/lib/queue";
import { toTags, type Candidate } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { candidate?: Candidate; verdict?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const { candidate, verdict } = body;
  if (!candidate?.name_key || !candidate.display) {
    return NextResponse.json({ error: "missing candidate" }, { status: 400 });
  }
  if (verdict !== "like" && verdict !== "pass") {
    return NextResponse.json({ error: "bad verdict" }, { status: 400 });
  }

  // The candidate round-trips through the client, so re-normalise tags rather
  // than trusting the shape that comes back.
  await decide({
    candidate: { ...candidate, tags: toTags(candidate.tags) },
    verdict,
  });
  return NextResponse.json({ ok: true });
}
