export type IntercomErrorCode =
  | "UNAUTHORIZED" | "RATE_LIMIT" | "TIMEOUT" | "SERVER_ERROR" | "UNKNOWN";

export class IntercomError extends Error {
  constructor(public code: IntercomErrorCode, public status: number, message: string) {
    super(message);
  }
}

export interface ICAdmin {
  id: string;
  type: "admin";
  name: string;
  email?: string;
}

export interface ICConversationStatistics {
  last_contact_reply_at: number | null;
  last_admin_reply_at: number | null;
}

export interface ICConversation {
  id: string;
  state: "open" | "closed" | "snoozed";
  updated_at: number;
  waiting_since: number | null;
  statistics: ICConversationStatistics;
  source: {
    body?: string;
    author?: { name?: string; email?: string };
  };
  contacts: { contacts: Array<{ id: string; name?: string; email?: string }> };
  team_assignee_id: string | null;
  admin_assignee_id: string | null;
}

export interface ICConversationPart {
  type: "conversation_part";
  part_type: string;
  created_at: number;
  author: { type: "admin" | "user" | "bot" | "lead"; id: string; name?: string };
  body?: string | null;
}

export interface ICConversationWithParts extends ICConversation {
  conversation_parts: { parts: ICConversationPart[] };
}

export interface ICTeam {
  id: string;
  name: string;
}
