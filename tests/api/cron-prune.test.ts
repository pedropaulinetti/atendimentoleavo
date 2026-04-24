import { describe, it, expect, beforeAll, vi } from "vitest";
import { NextRequest } from "next/server";

const deleteSpy = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      delete: () => ({
        lt: (column: string, value: string) => {
          deleteSpy(table, column, value);
          return Promise.resolve({ error: null, count: 0 });
        },
      }),
    }),
  }),
}));

beforeAll(() => {
  process.env.CRON_SECRET = "topsecret";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://x";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
});

describe("GET /api/cron/prune-metrics", () => {
  it("rejects without CRON_SECRET", async () => {
    const { GET } = await import("@/app/api/cron/prune-metrics/route");
    const res = await GET(new NextRequest("http://x/api/cron/prune-metrics"));
    expect(res.status).toBe(401);
  });

  it("deletes rows older than 90 days from both tables", async () => {
    deleteSpy.mockClear();
    const { GET } = await import("@/app/api/cron/prune-metrics/route");
    const req = new NextRequest("http://x/api/cron/prune-metrics", {
      headers: { authorization: "Bearer topsecret" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(deleteSpy).toHaveBeenCalledTimes(2);
    const tables = deleteSpy.mock.calls.map(c => c[0]).sort();
    expect(tables).toEqual(["funil_snapshots", "monitor_snapshots"]);
    const cutoff = new Date(deleteSpy.mock.calls[0][2]);
    const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
    expect(Math.abs(cutoff.getTime() - ninetyDaysAgo)).toBeLessThan(10_000);
  });
});
