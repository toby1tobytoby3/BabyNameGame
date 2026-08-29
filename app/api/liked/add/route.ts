import { NextResponse } from "next/server";
import { addLiked } from "@/lib/queue";
import type { Gender } from "@/lib/types";

export const dynamic = "force-dynamic";

const GENDERS: Gender[] = ["girl", "boy", "neutral"];
const MAX_LEN = 40;

export async function POST(req: Request) {
  let body: { display?: unknown; gender?: unknown; origin?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const display =
    typeof body.display === "string" ? body.display.trim().slice(0, MAX_LEN) : "";
  if (!display) {
    return NextResponse.json({ error: "Enter a name" }, { status: 400 });
  }
  if (!GENDERS.includes(body.gender as Gender)) {
    return NextResponse.json({ error: "Pick girl, boy or either" }, { status: 400 });
  }
  const origin =
    typeof body.origin === "string" && body.origin.trim()
      ? body.origin.trim().slice(0, MAX_LEN)
      : null;

  const result = await addLiked({
    display,
    gender: body.gender as Gender,
    origin,
  });
  // nameKey strips everything but letters, so "123" and "!!" reduce to nothing
  // and would be stored under an empty key that collides with the next one.
  if (!result) {
    return NextResponse.json(
      { error: "That doesn’t look like a name" },
      { status: 400 },
    );
  }

  return NextResponse.json(result);
}
