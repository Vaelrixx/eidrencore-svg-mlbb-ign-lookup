import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLAN_FALLBACKS } from "@/lib/platform";

export async function GET() {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("developer_plans").select("slug,name,price_paise,monthly_limit,enabled,description").order("price_paise");
    if (!error && data?.length) return NextResponse.json({ plans: data }, { headers: { "Cache-Control": "no-store" } });
  } catch { /* Return configurable fallback catalog when the database is not configured yet. */ }
  return NextResponse.json({ plans: PLAN_FALLBACKS }, { headers: { "Cache-Control": "no-store" } });
}
