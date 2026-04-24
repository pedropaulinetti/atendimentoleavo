import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";

const insertSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: unknown) => {
        insertSpy(table, row);
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

const server = setupServer();
beforeAll(() => {
  process.env.DATACRAZY_TOKEN = "test";
  process.env.PIPELINE_ID = "p1";
  process.env.CRON_SECRET = "topsecret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
  process.env.INTERCOM_ENABLED = "false";
  server.listen();
});
afterEach(() => { server.resetHandlers(); insertSpy.mockClear(); });
afterAll(() => server.close());
beforeEach(async () => {
  const { invalidateCache } = await import("@/lib/datacrazy/cache");
  invalidateCache();
});

function dcHandlersOk() {
  server.use(
    http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
      () => HttpResponse.json({ data: [{ id: "s1", name: "A", index: 0 }] })),
    http.get("https://api.g1.datacrazy.io/api/v1/conversations",
      () => HttpResponse.json({ data: [] })),
    http.get("https://api.g1.datacrazy.io/api/v1/businesses",
      () => HttpResponse.json({ count: 0, data: [] })),
  );
}

describe("GET /api/cron/snapshot-metrics", () => {
  it("rejects without CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/snapshot-metrics/route");
    const res = await GET(new NextRequest("http://x/api/cron/snapshot-metrics"));
    expect(res.status).toBe(401);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("inserts into both tables when authorized and DC succeeds", async () => {
    dcHandlersOk();
    const { GET } = await import("@/app/api/cron/snapshot-metrics/route");
    const req = new NextRequest("http://x/api/cron/snapshot-metrics", {
      headers: { authorization: "Bearer topsecret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalledTimes(2);
    const tables = insertSpy.mock.calls.map(c => c[0]).sort();
    expect(tables).toEqual(["funil_snapshots", "monitor_snapshots"]);
  });

  it("does not insert when Data Crazy fails completely", async () => {
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => new HttpResponse(null, { status: 401 })),
    );
    const { GET } = await import("@/app/api/cron/snapshot-metrics/route");
    const req = new NextRequest("http://x/api/cron/snapshot-metrics", {
      headers: { authorization: "Bearer topsecret" },
    });
    const res = await GET(req);
    expect([503, 500]).toContain(res.status);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
