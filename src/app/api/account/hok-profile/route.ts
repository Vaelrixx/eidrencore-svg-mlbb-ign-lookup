import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";
import { parseHokCampInviteLink } from "@/lib/hok-camp-invite.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PROFILE_FIELDS = "game_uid,nickname,icon,grade,score,world_id,consented_at,updated_at";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const { data, error } = await createAdminClient().from("developer_hok_profiles")
    .select(PROFILE_FIELDS).eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Could not load your HoK import." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ profile: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 8192) return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Invalid request body." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const chunks: Buffer[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      void reader.cancel();
      return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    chunks.push(Buffer.from(value));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let body: { link?: unknown; selfAttested?: unknown } | null;
  try { body = JSON.parse(raw) as typeof body; } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  if (body.selfAttested !== true) return NextResponse.json({ error: "Confirm that this is your own HoK account before importing." }, { status: 400 });

  const parsed = parseHokCampInviteLink(body.link);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: { "Cache-Control": "no-store" } });
  const now = new Date().toISOString();
  const row = {
    user_id: user.id,
    game_uid: parsed.profile.gameUid,
    nickname: parsed.profile.nickname,
    icon: parsed.profile.icon,
    grade: parsed.profile.grade,
    score: parsed.profile.score,
    world_id: parsed.profile.worldId,
    consented_at: now,
    updated_at: now,
  };
  const { data, error } = await createAdminClient().from("developer_hok_profiles")
    .upsert(row, { onConflict: "user_id" }).select(PROFILE_FIELDS).single();
  if (error || !data) return NextResponse.json({ error: "Could not save your HoK import." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ profile: data }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const { error } = await createAdminClient().from("developer_hok_profiles").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not remove your HoK import." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
