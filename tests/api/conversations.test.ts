import { describe, it, expect, beforeAll, afterAll, afterEach, vi, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}));

const server = setupServer();
beforeAll(() => {
  process.env.DATACRAZY_TOKEN = "test";
  process.env.PIPELINE_ID = "p1";
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(async () => {
  const { invalidateCache } = await import("@/lib/datacrazy/cache");
  invalidateCache();
});

describe("GET /api/conversations", () => {
  it("returns enriched, sorted list excluding ok/respondida", async () => {
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "A", index: 0 }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({ data: [
          { id: "c-red", isGroup: false, name: "Red", attendants: [{ id: "u1", name: "Ana" }],
            currentDepartment: { id: "d1", name: "Vendas", color: "#f00" },
            lastReceivedMessageDate: new Date(Date.now() - 40 * 60_000).toISOString(),
            lastSendedMessageDate: null },
          { id: "c-ok", isGroup: false, name: "OK", attendants: [],
            currentDepartment: null,
            lastReceivedMessageDate: new Date(Date.now() - 1 * 60_000).toISOString(),
            lastSendedMessageDate: null },
        ] })),
    );
    const { GET } = await import("@/app/api/conversations/route");
    const res = await GET();
    const json = await res.json();
    expect(json.conversations.length).toBe(1);
    expect(json.conversations[0].level).toBe("vermelho");
    expect(json.conversations[0].attendantName).toBe("Ana");
  });

  it("returns 503 on DC 401", async () => {
    server.use(http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
      () => new HttpResponse(null, { status: 401 })));
    const { GET } = await import("@/app/api/conversations/route");
    const res = await GET();
    expect(res.status).toBe(503);
  });
});

describe("GET /api/conversations — multi-source", () => {
  beforeEach(async () => {
    process.env.INTERCOM_TOKEN = "tok:test";
    process.env.INTERCOM_WORKSPACE_ID = "ws1";
    process.env.INTERCOM_ENABLED = "true";
    // Reset all module caches so tests don't leak state
    const { invalidateCache } = await import("@/lib/datacrazy/cache");
    invalidateCache();
    (await import("@/lib/intercom/admins")).__resetCache();
    (await import("@/lib/intercom/cache")).__reset();
    (await import("@/lib/intercom/teams")).__resetCache();
    delete process.env.INTERCOM_BOT_ADMIN_IDS;
  });

  it("merges DC and IC sorted by minutosParada ascending", async () => {
    const now = Date.now();
    const dcReceived = new Date(now - 5 * 60_000).toISOString();      // 5 min ago
    const icContactReply = Math.floor((now - 20 * 60_000) / 1000);    // 20 min ago (unix seconds)

    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "Atend", index: 0 }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({ data: [{
          id: "dc1", isGroup: false, name: "João",
          lastReceivedMessageDate: dcReceived, lastSendedMessageDate: null,
          attendants: [], currentDepartment: { id: "d1", name: "BR", color: "#f00" },
          lastMessage: { body: "olá" },
        }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations/dc1/messages",
        () => HttpResponse.json({ messages: [
          { body: "preciso de ajuda", received: true, createdAt: dcReceived },
        ] })),
      http.get("https://api.intercom.io/admins",
        () => HttpResponse.json({ admins: [] })),
      http.get("https://api.intercom.io/teams",
        () => HttpResponse.json({ teams: [] })),
      http.post("https://api.intercom.io/conversations/search",
        () => HttpResponse.json({ conversations: [{
          id: "ic1", state: "open", updated_at: 100, waiting_since: icContactReply,
          statistics: { last_contact_reply_at: icContactReply, last_admin_reply_at: null },
          source: { body: "help please", author: { name: "Maria" } },
          contacts: { contacts: [{ id: "u1", name: "Maria" }] },
          team_assignee_id: null, admin_assignee_id: null,
        }] })),
    );

    const { GET } = await import("@/app/api/conversations/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.conversations).toHaveLength(2);
    expect(body.conversations[0].id).toBe("dc:dc1");
    expect(body.conversations[0].source).toBe("datacrazy");
    expect(body.conversations[1].id).toBe("ic:ic1");
    expect(body.conversations[1].source).toBe("intercom");
    expect(body.sourceErrors).toBeUndefined();
  });

  it("returns only DC with sourceErrors.intercom when IC search returns 429", async () => {
    const now = Date.now();
    const dcReceived = new Date(now - 5 * 60_000).toISOString();

    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "Atend", index: 0 }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({ data: [{
          id: "dc1", isGroup: false, name: "João",
          lastReceivedMessageDate: dcReceived, lastSendedMessageDate: null,
          attendants: [], currentDepartment: { id: "d1", name: "BR", color: "#f00" },
          lastMessage: { body: "olá" },
        }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations/dc1/messages",
        () => HttpResponse.json({ messages: [
          { body: "preciso de ajuda", received: true, createdAt: dcReceived },
        ] })),
      http.get("https://api.intercom.io/admins",
        () => HttpResponse.json({ admins: [] })),
      http.get("https://api.intercom.io/teams",
        () => HttpResponse.json({ teams: [] })),
      http.post("https://api.intercom.io/conversations/search",
        () => HttpResponse.json({}, { status: 429 })),
    );

    const { GET } = await import("@/app/api/conversations/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.conversations.length).toBeGreaterThan(0);
    for (const c of body.conversations) {
      expect(c.id.startsWith("dc:")).toBe(true);
    }
    expect(body.sourceErrors).toBeDefined();
    expect(body.sourceErrors.intercom).toBe("rate_limit");
  });

  it("returns only IC with sourceErrors.datacrazy when DC /conversations returns 500", async () => {
    const now = Date.now();
    const icContactReply = Math.floor((now - 20 * 60_000) / 1000);

    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "Atend", index: 0 }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({}, { status: 500 })),
      http.get("https://api.intercom.io/admins",
        () => HttpResponse.json({ admins: [] })),
      http.get("https://api.intercom.io/teams",
        () => HttpResponse.json({ teams: [] })),
      http.post("https://api.intercom.io/conversations/search",
        () => HttpResponse.json({ conversations: [{
          id: "ic1", state: "open", updated_at: 100, waiting_since: icContactReply,
          statistics: { last_contact_reply_at: icContactReply, last_admin_reply_at: null },
          source: { body: "help please", author: { name: "Maria" } },
          contacts: { contacts: [{ id: "u1", name: "Maria" }] },
          team_assignee_id: null, admin_assignee_id: null,
        }] })),
    );

    const { GET } = await import("@/app/api/conversations/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.conversations.length).toBeGreaterThan(0);
    for (const c of body.conversations) {
      expect(c.id.startsWith("ic:")).toBe(true);
    }
    expect(body.sourceErrors).toBeDefined();
    expect(body.sourceErrors.datacrazy).toBeDefined();
  });

  it("returns 503 when both sources fail", async () => {
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "Atend", index: 0 }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({}, { status: 500 })),
      http.get("https://api.intercom.io/admins",
        () => HttpResponse.json({ admins: [] })),
      http.get("https://api.intercom.io/teams",
        () => HttpResponse.json({ teams: [] })),
      http.post("https://api.intercom.io/conversations/search",
        () => HttpResponse.json({}, { status: 500 })),
    );

    const { GET } = await import("@/app/api/conversations/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toBe("ALL_SOURCES_FAILED");
    expect(body.sourceErrors).toBeDefined();
    expect(body.sourceErrors.datacrazy).toBeDefined();
    expect(body.sourceErrors.intercom).toBeDefined();
  });

  it("skips IC fetch when INTERCOM_ENABLED=false", async () => {
    process.env.INTERCOM_ENABLED = "false";
    let icCalls = 0;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () => {
        icCalls++;
        return HttpResponse.json({ conversations: [] });
      }),
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({ data: [] })),
    );

    const { GET } = await import("@/app/api/conversations/route");
    const res = await GET();
    const body = await res.json();

    expect(icCalls).toBe(0);
    expect(body.sourceErrors).toBeUndefined();
  });
});
