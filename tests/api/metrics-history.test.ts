import { describe, it, expect, beforeAll, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  }),
}));

let fakeRows: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        gte: () => ({
          order: () => Promise.resolve({ data: fakeRows, error: null }),
        }),
      }),
    }),
  }),
}));

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});
beforeEach(() => { fakeRows = []; });

describe("GET /api/metrics/history", () => {
  it("returns 400 for invalid source", async () => {
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=foo&range=7d"));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid range", async () => {
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=monitor&range=1y"));
    expect(res.status).toBe(400);
  });

  it("returns empty points array when no rows", async () => {
    fakeRows = [];
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=monitor&range=7d"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.points).toEqual([]);
    expect(json.sourceCount).toBe(0);
  });

  it("maps monitor rows to camelCase points", async () => {
    fakeRows = [
      {
        captured_at: new Date().toISOString(),
        total: 3, count_red: 1, count_yellow: 1, count_green: 1,
        avg_minutos: 12.5, max_minutos: 40,
        by_department: [{ name: "Vendas", color: "#f00", count: 2 }],
      },
    ];
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=monitor&range=24h"));
    const json = await res.json();
    expect(json.points[0].total).toBe(3);
    expect(json.points[0].countRed).toBe(1);
    expect(json.points[0].avgMinutos).toBe(12.5);
    expect(json.points[0].byDepartment).toHaveLength(1);
  });

  it("maps funil rows to camelCase points", async () => {
    fakeRows = [
      {
        captured_at: new Date().toISOString(),
        total_deals: 42, total_stuck: 5, avg_stage_days: 2.5, active_stages: 3,
        stages: [{ id: "s1", name: "A", index: 0, count: 5, avgMs: 100, stuck: 1 }],
      },
    ];
    const { GET } = await import("@/app/api/metrics/history/route");
    const res = await GET(new NextRequest("http://x/api/metrics/history?source=funil&range=24h"));
    const json = await res.json();
    expect(json.points[0].totalDeals).toBe(42);
    expect(json.points[0].totalStuck).toBe(5);
    expect(json.points[0].avgStageDays).toBe(2.5);
    expect(json.points[0].activeStages).toBe(3);
    expect(Array.isArray(json.points[0].stages)).toBe(true);
  });
});
