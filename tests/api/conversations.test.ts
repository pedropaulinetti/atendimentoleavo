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
        () => HttpResponse.json({ data: [{ id: "s1", name: "A", order: 1, pipelineId: "p1" }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/conversations",
        () => HttpResponse.json({ data: [
          { id: "c-red", isGroup: false, name: "Red", attendants: [{ id: "u1" }],
            currentDepartment: { id: "d1", name: "Vendas", color: "#f00" },
            lastReceivedMessageDate: new Date(Date.now() - 40 * 60_000).toISOString(),
            lastSendedMessageDate: null },
          { id: "c-ok", isGroup: false, name: "OK", attendants: [],
            currentDepartment: null,
            lastReceivedMessageDate: new Date(Date.now() - 1 * 60_000).toISOString(),
            lastSendedMessageDate: null },
        ] })),
      http.get("https://api.g1.datacrazy.io/api/v1/users",
        () => HttpResponse.json({ data: [{ id: "u1", name: "Ana" }] }))
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
