import { fetchAndMapDCConversations } from "@/lib/datacrazy/mapper";
import { fetchAndMapIntercomConversations } from "@/lib/intercom/mapper";
import { DataCrazyError } from "@/lib/datacrazy/types";
import { IntercomError } from "@/lib/intercom/types";
import type { Conversation, ConversationSource } from "@/lib/monitor/types";

export interface MonitorSnapshot {
  total: number;
  countRed: number;
  countYellow: number;
  countGreen: number;
  avgMinutos: number;
  maxMinutos: number;
  byDepartment: Array<{ name: string; color: string; count: number }>;
}

export interface MonitorCapture {
  snapshot: MonitorSnapshot;
  conversations: Conversation[];
  sourceErrors: Partial<Record<ConversationSource, string>>;
  allFailed: boolean;
  capturedAt: string;
}

export function computeMonitorSnapshot(conversations: Conversation[]): MonitorSnapshot {
  const total = conversations.length;
  const byLevel = (lvl: Conversation["level"]) =>
    conversations.filter(c => c.level === lvl).length;

  const avgMinutos = total
    ? conversations.reduce((s, c) => s + c.minutosParada, 0) / total
    : 0;
  const maxMinutos = total
    ? Math.max(...conversations.map(c => c.minutosParada))
    : 0;

  const byDepartmentMap = new Map<string, { name: string; color: string; count: number }>();
  for (const c of conversations) {
    const hit = byDepartmentMap.get(c.departmentName);
    if (hit) hit.count += 1;
    else byDepartmentMap.set(c.departmentName, {
      name: c.departmentName, color: c.departmentColor, count: 1,
    });
  }
  const byDepartment = Array.from(byDepartmentMap.values()).sort((a, b) => b.count - a.count);

  return {
    total,
    countRed: byLevel("vermelho"),
    countYellow: byLevel("amarelo"),
    countGreen: byLevel("verdeAlerta"),
    avgMinutos,
    maxMinutos,
    byDepartment,
  };
}

function errorCode(err: unknown): string {
  if (err instanceof DataCrazyError || err instanceof IntercomError) {
    return err.code.toLowerCase();
  }
  return "unknown";
}

export async function captureMonitor(now: number = Date.now()): Promise<MonitorCapture> {
  const icEnabled = process.env.INTERCOM_ENABLED === "true";

  const [dcResult, icResult] = await Promise.allSettled([
    fetchAndMapDCConversations(now),
    icEnabled ? fetchAndMapIntercomConversations(now) : Promise.resolve([] as Conversation[]),
  ]);

  const sourceErrors: Partial<Record<ConversationSource, string>> = {};
  const conversations: Conversation[] = [];

  if (dcResult.status === "fulfilled") conversations.push(...dcResult.value);
  else {
    sourceErrors.datacrazy = errorCode(dcResult.reason);
    console.warn("[monitor] datacrazy failed", dcResult.reason);
  }

  if (icEnabled) {
    if (icResult.status === "fulfilled") conversations.push(...icResult.value);
    else {
      sourceErrors.intercom = errorCode(icResult.reason);
      console.warn("[monitor] intercom failed", icResult.reason);
    }
  }

  conversations.sort((a, b) => a.minutosParada - b.minutosParada);

  const allFailed =
    dcResult.status === "rejected" && (!icEnabled || icResult.status === "rejected");

  return {
    snapshot: computeMonitorSnapshot(conversations),
    conversations,
    sourceErrors,
    allFailed,
    capturedAt: new Date(now).toISOString(),
  };
}

export async function captureMonitorSnapshot(): Promise<MonitorSnapshot> {
  return (await captureMonitor()).snapshot;
}
