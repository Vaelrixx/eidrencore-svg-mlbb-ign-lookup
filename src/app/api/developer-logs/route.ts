import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/platform";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, Math.floor(limitRaw))) : 50;
  const admin = createAdminClient();
  const [auditResult, requestResult] = await Promise.all([
    admin.from("developer_audit_logs").select("id,workspace_id,action,resource_type,resource_id,metadata,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(limit),
    admin.from("developer_api_request_logs").select("id,api_key_id,request_id,endpoint,http_status,response_ms,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(limit),
  ]);
  if (auditResult.error || requestResult.error) return NextResponse.json({ error: "Could not load developer logs. Apply the workspace/audit migration first." }, { status: 500 });
  return NextResponse.json({ audit: auditResult.data || [], requests: requestResult.data || [] }, { headers: { "Cache-Control": "no-store" } });
}
