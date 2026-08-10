import { NextResponse } from "next/server";
import { LIBRARY_ORIGINS } from "@/lib/library";
import { getPreferences, savePreferences } from "@/lib/queue";
import type { Preferences } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    preferences: await getPreferences(),
    availableOrigins: LIBRARY_ORIGINS,
  });
}

export async function PUT(req: Request) {
  let body: Partial<Preferences>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const patch: Partial<Preferences> = {};

  if (Array.isArray(body.origins)) {
    patch.origins = body.origins
      .filter((o) => o && typeof o.origin === "string")
      .map((o) => ({
        origin: o.origin,
        weight: Math.min(Math.max(Number(o.weight) || 1, 0), 5),
      }));
  }
  if (body.similar_new_mix !== undefined) {
    patch.similar_new_mix = Math.min(
      Math.max(Number(body.similar_new_mix), 0),
      1,
    );
  }
  if (body.origin_mode === "soft" || body.origin_mode === "hard") {
    patch.origin_mode = body.origin_mode;
  }
  if (body.surname !== undefined) {
    patch.surname =
      typeof body.surname === "string" && body.surname.trim()
        ? body.surname.trim().slice(0, 60)
        : null;
  }
  if (body.topup_threshold !== undefined) {
    patch.topup_threshold = Math.min(
      Math.max(Math.round(Number(body.topup_threshold) || 30), 5),
      200,
    );
  }

  return NextResponse.json({ preferences: await savePreferences(patch) });
}
