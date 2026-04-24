import type { AlertLevel } from "./severity";
export type { AlertLevel };

export type ConversationSource = "datacrazy" | "intercom";

export interface Conversation {
  id: string;
  source: ConversationSource;
  name: string;
  level: Exclude<AlertLevel, "ok" | "respondida">;
  minutosParada: number;
  attendantName: string;
  departmentName: string;
  departmentColor: string;
  lastMessage: string | null;
  externalUrl?: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
  updatedAt: string;
  stats: {
    avgMinutos: number;
    maxMinutos: number;
    byDepartment: { name: string; color: string; count: number }[];
  };
  sourceErrors?: Partial<Record<ConversationSource, string>>;
}
