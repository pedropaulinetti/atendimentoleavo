import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStages, handleDCError } from "@/lib/datacrazy/pipeline";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const stages = await getStages();
    return NextResponse.json({ stages });
  } catch (err) {
    return handleDCError(err);
  }
}
