import { dcFetch } from "@/lib/datacrazy/client";
import { cached } from "@/lib/datacrazy/cache";
import { DataCrazyError } from "@/lib/datacrazy/types";
import { NextResponse } from "next/server";
import type { DCPipelineStage } from "@/lib/datacrazy/types";

const PIPELINE_ID = () => process.env.PIPELINE_ID!;

export async function getStages(): Promise<DCPipelineStage[]> {
  const pid = PIPELINE_ID();
  return cached(`stages:${pid}`, 5 * 60_000, async () => {
    const res = await dcFetch<{ data: DCPipelineStage[] } | DCPipelineStage[]>(`/pipelines/${pid}/stages`);
    return Array.isArray(res) ? res : res.data;
  });
}

export function handleDCError(err: unknown) {
  if (err instanceof DataCrazyError) {
    const status = err.code === "UNAUTHORIZED" ? 503 :
                   err.code === "RATE_LIMIT" ? 429 :
                   err.code === "TIMEOUT" ? 504 : 502;
    return NextResponse.json({ error: err.code, message: err.message }, { status });
  }
  console.error("Unexpected error:", err);
  return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
}
