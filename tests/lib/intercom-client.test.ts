import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer();
beforeAll(() => { process.env.INTERCOM_TOKEN = "tok:test"; server.listen(); });
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("icFetch", () => {
  it("sends bearer token and returns JSON", async () => {
    server.use(
      http.get("https://api.intercom.io/admins", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer tok:test");
        return HttpResponse.json({ admins: [{ id: "1", type: "admin", name: "Ana" }] });
      }),
    );
    const { icFetch } = await import("@/lib/intercom/client");
    const res = await icFetch<{ admins: { id: string }[] }>("GET", "/admins");
    expect(res.admins[0].id).toBe("1");
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    server.use(http.get("https://api.intercom.io/admins", () =>
      HttpResponse.json({}, { status: 401 }),
    ));
    const { icFetch } = await import("@/lib/intercom/client");
    await expect(icFetch("GET", "/admins")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("maps 429 to RATE_LIMIT", async () => {
    server.use(http.get("https://api.intercom.io/admins", () =>
      HttpResponse.json({}, { status: 429 }),
    ));
    const { icFetch } = await import("@/lib/intercom/client");
    await expect(icFetch("GET", "/admins")).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("POST sends JSON body", async () => {
    server.use(
      http.post("https://api.intercom.io/conversations/search", async ({ request }) => {
        const body = await request.json();
        expect(body).toEqual({ query: { field: "state", operator: "=", value: "open" } });
        return HttpResponse.json({ conversations: [] });
      }),
    );
    const { icFetch } = await import("@/lib/intercom/client");
    await icFetch("POST", "/conversations/search", {
      query: { field: "state", operator: "=", value: "open" },
    });
  });
});
