import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => { process.env.INTERCOM_TOKEN = "tok:test"; server.listen(); });
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(async () => {
  const mod = await import("@/lib/intercom/admins");
  mod.__resetCache();
  delete process.env.INTERCOM_BOT_ADMIN_IDS;
});

describe("getBotAdminIds", () => {
  it("env-configured bot IDs win over name-match when both present", async () => {
    process.env.INTERCOM_BOT_ADMIN_IDS = "123,456";
    server.use(http.get("https://api.intercom.io/admins", () =>
      HttpResponse.json({ admins: [
        { id: "7", type: "admin", name: "Fin" },
        { id: "123", type: "admin", name: "Ana" },
      ]})));
    const { getBotAdminIds } = await import("@/lib/intercom/admins");
    const ids = await getBotAdminIds();
    expect(ids.has("123")).toBe(true);
    expect(ids.has("456")).toBe(true);
    expect(ids.has("7")).toBe(false);
  });

  it("falls back to /admins name match when env is empty", async () => {
    server.use(http.get("https://api.intercom.io/admins", () =>
      HttpResponse.json({ admins: [
        { id: "1", type: "admin", name: "Ana" },
        { id: "2", type: "admin", name: "Fin AI" },
        { id: "3", type: "admin", name: "Operator" },
      ]})));
    const { getBotAdminIds } = await import("@/lib/intercom/admins");
    const ids = await getBotAdminIds();
    expect(ids.has("1")).toBe(false);
    expect(ids.has("2")).toBe(true);
    expect(ids.has("3")).toBe(true);
  });

  it("caches result for 1h", async () => {
    let calls = 0;
    server.use(http.get("https://api.intercom.io/admins", () => {
      calls++;
      return HttpResponse.json({ admins: [{ id: "9", type: "admin", name: "Fin" }] });
    }));
    const { getBotAdminIds } = await import("@/lib/intercom/admins");
    await getBotAdminIds();
    await getBotAdminIds();
    expect(calls).toBe(1);
  });
});
