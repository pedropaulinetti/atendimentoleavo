import { describe, it, expect } from "vitest";
import { computeAlertLevel } from "@/lib/monitor/severity";

const now = new Date("2026-04-17T14:00:00Z").getTime();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

describe("computeAlertLevel", () => {
  it("returns respondida when lastReceived is null", () => {
    expect(computeAlertLevel({
      lastReceivedMessageDate: null, lastSendedMessageDate: minsAgo(5), now,
    })).toEqual({ level: "respondida", minutosParada: 0 });
  });

  it("returns respondida when team replied after client", () => {
    expect(computeAlertLevel({
      lastReceivedMessageDate: minsAgo(20), lastSendedMessageDate: minsAgo(5), now,
    })).toEqual({ level: "respondida", minutosParada: 0 });
  });

  it("returns ok when client sent < 3 min ago", () => {
    expect(computeAlertLevel({
      lastReceivedMessageDate: minsAgo(2), lastSendedMessageDate: minsAgo(10), now,
    }).level).toBe("ok");
  });

  it.each([
    [4, "verdeAlerta"], [10.5, "amarelo"], [31, "vermelho"],
    [3.01, "verdeAlerta"], [10.01, "amarelo"], [30.01, "vermelho"],
  ])("minutes %f → %s", (m, level) => {
    expect(computeAlertLevel({
      lastReceivedMessageDate: minsAgo(m), lastSendedMessageDate: null, now,
    }).level).toBe(level);
  });

  it("boundaries: exactly 3, 10, 30 stay in lower bucket", () => {
    const cases: [number, string][] = [[3, "ok"], [10, "verdeAlerta"], [30, "amarelo"]];
    for (const [m, level] of cases) {
      expect(computeAlertLevel({
        lastReceivedMessageDate: minsAgo(m), lastSendedMessageDate: null, now,
      }).level).toBe(level);
    }
  });
});
