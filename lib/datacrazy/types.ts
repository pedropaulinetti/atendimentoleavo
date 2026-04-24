export type DataCrazyErrorCode =
  | "UNAUTHORIZED" | "RATE_LIMIT" | "TIMEOUT" | "SERVER_ERROR" | "UNKNOWN";

export class DataCrazyError extends Error {
  constructor(public code: DataCrazyErrorCode, public status: number, message: string) {
    super(message);
  }
}

export interface DCConversation {
  id: string;
  isGroup: boolean;
  name: string;
  lastReceivedMessageDate?: string | null;
  lastSendedMessageDate?: string | null;
  attendants: Array<{ id: string; userId?: string; name?: string; email?: string }>;
  currentDepartment?: { id: string; name: string; color: string } | null;
  contact?: { externalInfo?: { pipelineIds?: string[]; stageIds?: string[] } };
  lastMessage?: {
    body?: string;
    received?: boolean;
    status?: string;
    createdAt?: string;
  } | null;
}

export interface DCDeal {
  id: string;
  name: string;
  stageId: string;
  status: "won" | "in_process" | "lost";
  createdAt: string;
  lastMovedAt: string | null;
  value: number | null;
}

export interface DCPipelineStage {
  id: string;
  name: string;
  index: number;
  color?: string;
}

export interface DCUser {
  id: string;
  name: string;
  email?: string;
}
