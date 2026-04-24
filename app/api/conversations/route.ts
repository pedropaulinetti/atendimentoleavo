import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAndMapDCConversations, handleDCError } from "@/lib/datacrazy/mapper";
import type { Conversation } from "@/lib/monitor/types";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const now = Date.now();
    const conversations: Conversation[] = (await fetchAndMapDCConversations(now))
      .sort((a, b) => a.minutosParada - b.minutosParada);

    const avgMinutos = conversations.length
      ? conversations.reduce((s, c) => s + c.minutosParada, 0) / conversations.length
      : 0;
    const maxMinutos = conversations.length
      ? Math.max(...conversations.map(c => c.minutosParada))
      : 0;

    const byDepartmentMap = new Map<string, { name: string; color: string; count: number }>();
    for (const c of conversations) {
      const key = c.departmentName;
      const hit = byDepartmentMap.get(key);
      if (hit) hit.count += 1;
      else byDepartmentMap.set(key, { name: c.departmentName, color: c.departmentColor, count: 1 });
    }
    const byDepartment = Array.from(byDepartmentMap.values()).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      conversations, updatedAt: new Date().toISOString(),
      stats: { avgMinutos, maxMinutos, byDepartment },
    });
  } catch (err) { return handleDCError(err); }
}
