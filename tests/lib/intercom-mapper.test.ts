import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => {
  process.env.INTERCOM_TOKEN = "tok:test";
  process.env.INTERCOM_WORKSPACE_ID = "ws1";
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  (await import("@/lib/intercom/admins")).__resetCache();
  (await import("@/lib/intercom/cache")).__reset();
  (await import("@/lib/intercom/teams")).__resetCache();
  delete process.env.INTERCOM_BOT_ADMIN_IDS;
});

function icConv(overrides: any) {
  return {
    id: "c1", state: "open", updated_at: 1000, waiting_since: null,
    statistics: { last_contact_reply_at: null, last_admin_reply_at: null },
    source: { body: "olá", author: { name: "Cliente" } },
    contacts: { contacts: [{ id: "u1", name: "Cliente", email: "c@x.com" }] },
    team_assignee_id: null, admin_assignee_id: null,
    ...overrides,
  };
}

describe("fetchAndMapIntercomConversations", () => {
  it("maps obviously-waiting conv without fetching parts", async () => {
    const now = 10_000_000;
    const contactReply = (now - 20 * 60_000) / 1000;

    let partsFetched = 0;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: null },
        })] })),
      http.get("https://api.intercom.io/conversations/:id", () => {
        partsFetched++;
        return HttpResponse.json({});
      }),
    );

    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("intercom");
    expect(out[0].id).toBe("ic:c1");
    expect(out[0].level).toBe("amarelo");
    expect(partsFetched).toBe(0);
  });

  it("excludes conv when human admin replied last", async () => {
    const now = 10_000_000;
    const contactReply = (now - 20 * 60_000) / 1000;
    const adminReply = (now - 5 * 60_000) / 1000;

    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: adminReply },
        })] })),
      http.get("https://api.intercom.io/conversations/c1", () =>
        HttpResponse.json(icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: adminReply },
          conversation_parts: { parts: [
            { type: "conversation_part", part_type: "comment", created_at: adminReply,
              author: { type: "admin", id: "99", name: "Ana" }, body: "oi" },
          ]},
        }))),
    );

    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out).toHaveLength(0);
  });

  it("keeps conv as waiting when last admin reply is from bot", async () => {
    process.env.INTERCOM_BOT_ADMIN_IDS = "99";
    const now = 10_000_000;
    const contactReply = (now - 20 * 60_000) / 1000;
    const botReply = (now - 5 * 60_000) / 1000;

    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: botReply },
        })] })),
      http.get("https://api.intercom.io/conversations/c1", () =>
        HttpResponse.json(icConv({
          conversation_parts: { parts: [
            { type: "conversation_part", part_type: "comment", created_at: botReply,
              author: { type: "admin", id: "99", name: "Fin" }, body: "bot oi" },
          ]},
        }))),
    );

    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out).toHaveLength(1);
    expect(out[0].minutosParada).toBeGreaterThanOrEqual(20);
  });

  it("cache hit skips parts fetch on second call with same updated_at", async () => {
    const now = 10_000_000;
    const contactReply = (now - 20 * 60_000) / 1000;
    const adminReply = (now - 5 * 60_000) / 1000;

    let partsFetched = 0;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: contactReply, last_admin_reply_at: adminReply },
        })] })),
      http.get("https://api.intercom.io/conversations/c1", () => {
        partsFetched++;
        return HttpResponse.json(icConv({
          conversation_parts: { parts: [
            { type: "conversation_part", part_type: "comment", created_at: adminReply,
              author: { type: "admin", id: "99", name: "Ana" } },
          ]},
        }));
      }),
    );

    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    await fetchAndMapIntercomConversations(now);
    await fetchAndMapIntercomConversations(now);
    expect(partsFetched).toBe(1);
  });

  it("unassigned conv gets 'Sem atendente' and 'Intercom' department", async () => {
    const now = 10_000_000;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: (now - 15 * 60_000) / 1000, last_admin_reply_at: null },
        })] })),
    );
    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out[0].attendantName).toBe("Sem atendente");
    expect(out[0].departmentName).toBe("Intercom");
  });

  it("builds externalUrl from workspace ID", async () => {
    const now = 10_000_000;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: (now - 15 * 60_000) / 1000, last_admin_reply_at: null },
        })] })),
    );
    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out[0].externalUrl).toBe("https://app.intercom.com/a/apps/ws1/inbox/conversation/c1");
  });

  it("filters out ancient convs above MAX_AGE_MINUTES", async () => {
    const now = 10_000_000;
    const ancient = (now - 100 * 60 * 60_000) / 1000;
    server.use(
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          statistics: { last_contact_reply_at: ancient, last_admin_reply_at: null },
        })] })),
    );
    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out).toHaveLength(0);
  });

  it("enriches attendantName with admin name when assigned", async () => {
    const now = 10_000_000;
    server.use(
      http.get("https://api.intercom.io/admins", () => HttpResponse.json({ admins: [
        { id: "77", type: "admin", name: "Ana" },
      ]})),
      http.get("https://api.intercom.io/teams", () => HttpResponse.json({ teams: [] })),
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          admin_assignee_id: "77",
          statistics: { last_contact_reply_at: (now - 15 * 60_000) / 1000, last_admin_reply_at: null },
        })] })),
    );
    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out[0].attendantName).toBe("Ana");
  });

  it("enriches departmentName with team name when assigned", async () => {
    const now = 10_000_000;
    server.use(
      http.get("https://api.intercom.io/admins", () => HttpResponse.json({ admins: [] })),
      http.get("https://api.intercom.io/teams", () => HttpResponse.json({ teams: [
        { id: "t1", name: "Suporte" },
      ]})),
      http.post("https://api.intercom.io/conversations/search", () =>
        HttpResponse.json({ conversations: [icConv({
          team_assignee_id: "t1",
          statistics: { last_contact_reply_at: (now - 15 * 60_000) / 1000, last_admin_reply_at: null },
        })] })),
    );
    const { fetchAndMapIntercomConversations } = await import("@/lib/intercom/mapper");
    const out = await fetchAndMapIntercomConversations(now);
    expect(out[0].departmentName).toBe("Suporte");
  });
});
