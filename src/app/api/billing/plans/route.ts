import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PLAN_FALLBACKS } from "@/lib/platform";

export const dynamic = "force-dynamic";

function recurringConfigured() {
  return Boolean(
    process.env.RAZORPAY_KEY_ID?.trim() &&
    process.env.RAZORPAY_KEY_SECRET?.trim() &&
    process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
  );
}

export async function GET() {
  let plans = PLAN_FALLBACKS;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("developer_plans")
      .select("slug,name,price_paise,monthly_limit,enabled,description").order("price_paise");
    if (!error && data?.length) plans = data;
  } catch {
    // If Supabase has not been configured yet, the fallback catalog remains read-only.
  }
  return NextResponse.json({
    plans,
    recurringConfigured: recurringConfigured(),
  }, { headers: { "Cache-Control": "no-store" } });
}
