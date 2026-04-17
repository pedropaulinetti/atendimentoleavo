import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { dcFetch } from "@/lib/datacrazy/client";
import { DataCrazyError } from "@/lib/datacrazy/types";

const server = setupServer();
beforeAll(() => { process.env.DATACRAZY_TOKEN = "test"; server.listen(); });
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("dcFetch", () => {
  it("returns JSON on 200", async () => {
    server.use(http.get("https://api.g1.datacrazy.io/api/v1/ping",
      () => HttpResponse.json({ ok: true })));
    expect(await dcFetch("/ping")).toEqual({ ok: true });
  });

  it("throws UNAUTHORIZED on 401", async () => {
    server.use(http.get("https://api.g1.datacrazy.io/api/v1/ping",
      () => new HttpResponse(null, { status: 401 })));
    await expect(dcFetch("/ping")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("retries once on 5xx then succeeds", async () => {
    let hits = 0;
    server.use(http.get("https://api.g1.datacrazy.io/api/v1/ping", () => {
      hits++;
      if (hits === 1) return new HttpResponse(null, { status: 503 });
      return HttpResponse.json({ ok: true });
    }));
    expect(await dcFetch("/ping")).toEqual({ ok: true });
    expect(hits).toBe(2);
  });
});
