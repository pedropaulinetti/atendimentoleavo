import { describe, it, expect } from "vitest";
import { resolveDateRangePreset } from "@/lib/funil/dateRange";

const ref = new Date("2026-04-17T15:30:00Z");

describe("resolveDateRangePreset", () => {
  it("today = start and end of day", () => {
    const r = resolveDateRangePreset("today", ref);
    expect(r.from).toBe("2026-04-17T00:00:00.000Z");
    expect(r.to).toBe("2026-04-17T23:59:59.999Z");
  });

  it("week = last 7 days ending today", () => {
    const r = resolveDateRangePreset("week", ref);
    expect(r.from).toBe("2026-04-10T00:00:00.000Z");
    expect(r.to).toBe("2026-04-17T23:59:59.999Z");
  });

  it("30d = last 30 days ending today", () => {
    const r = resolveDateRangePreset("30d", ref);
    expect(r.from).toBe("2026-03-18T00:00:00.000Z");
    expect(r.to).toBe("2026-04-17T23:59:59.999Z");
  });

  it("month = current month", () => {
    const r = resolveDateRangePreset("month", ref);
    expect(r.from).toBe("2026-04-01T00:00:00.000Z");
  });
});
