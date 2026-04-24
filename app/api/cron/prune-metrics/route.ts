import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const RETENTION_DAYS = 90;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const db = createAdminClient();

  const m = await db.from("monitor_snapshots").delete().lt("captured_at", cutoff);
  if (m.error) return NextResponse.json({ error: m.error.message }, { status: 500 });

  const f = await db.from("funil_snapshots").delete().lt("captured_at", cutoff);
  if (f.error) return NextResponse.json({ error: f.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, cutoff });
}
