import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }),
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

function makeDeal(i: number) {
  return { id: `d${i}`, name: `Deal ${i}`, stageId: "s1", status: "in_process",
    createdAt: new Date().toISOString(), lastMovedAt: new Date().toISOString(), value: 100 };
}

describe("GET /api/deals", () => {
  it("aggregates pages and marks truncated at 5-page ceiling", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.use(
      http.get("https://api.g1.datacrazy.io/api/v1/pipelines/p1/stages",
        () => HttpResponse.json({ data: [{ id: "s1", name: "A", order: 1, pipelineId: "p1" }] })),
      http.get("https://api.g1.datacrazy.io/api/v1/businesses",
        () => HttpResponse.json({ count: 9999, data: Array.from({ length: 500 }, (_, i) => makeDeal(i)) })),
    );
    const { GET } = await import("@/app/api/deals/route");
    const req = new NextRequest("http://x/api/deals?from=2026-01-01&to=2026-12-31");
    const res = await GET(req);
    const json = await res.json();
    expect(json.truncated).toBe(true);
    expect(json.total).toBe(2500);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
