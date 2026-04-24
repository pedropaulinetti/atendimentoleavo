import { describe, it, expect } from "vitest";
import { computeMonitorSnapshot } from "@/lib/monitor/snapshot";
import type { Conversation } from "@/lib/monitor/types";

function mkConv(
  overrides: Partial<Conversation> & { level: Conversation["level"]; minutosParada: number },
): Conversation {
  return {
    id: overrides.id ?? "x",
    source: overrides.source ?? "datacrazy",
    name: overrides.name ?? "Conv",
    attendantName: overrides.attendantName ?? "—",
    departmentName: overrides.departmentName ?? "Geral",
    departmentColor: overrides.departmentColor ?? "#666",
    lastMessage: overrides.lastMessage ?? null,
    ...overrides,
  };
}

describe("computeMonitorSnapshot", () => {
  it("returns zeros when conversations are empty", () => {
    const snap = computeMonitorSnapshot([]);
    expect(snap).toEqual({
      total: 0,
      countRed: 0,
      countYellow: 0,
      countGreen: 0,
      avgMinutos: 0,
      maxMinutos: 0,
      byDepartment: [],
    });
  });

  it("aggregates level counts, avg/max, and by-department sorted desc", () => {
    const convs: Conversation[] = [
      mkConv({ id: "a", level: "vermelho",    minutosParada: 40, departmentName: "Vendas",  departmentColor: "#f00" }),
      mkConv({ id: "b", level: "amarelo",     minutosParada: 20, departmentName: "Vendas",  departmentColor: "#f00" }),
      mkConv({ id: "c", level: "verdeAlerta", minutosParada: 5,  departmentName: "Suporte", departmentColor: "#0f0" }),
    ];
    const snap = computeMonitorSnapshot(convs);

    expect(snap.total).toBe(3);
    expect(snap.countRed).toBe(1);
    expect(snap.countYellow).toBe(1);
    expect(snap.countGreen).toBe(1);
    expect(snap.maxMinutos).toBe(40);
    expect(snap.avgMinutos).toBeCloseTo((40 + 20 + 5) / 3);
    expect(snap.byDepartment).toHaveLength(2);
    expect(snap.byDepartment[0].name).toBe("Vendas");
    expect(snap.byDepartment[0].count).toBe(2);
    expect(snap.byDepartment[1].name).toBe("Suporte");
    expect(snap.byDepartment[1].count).toBe(1);
  });

  it("groups departments case-sensitively by name (unique color per group)", () => {
    const convs: Conversation[] = [
      mkConv({ id: "a", level: "vermelho", minutosParada: 10, departmentName: "BR", departmentColor: "#abc" }),
      mkConv({ id: "b", level: "amarelo",  minutosParada: 15, departmentName: "BR", departmentColor: "#abc" }),
    ];
    const snap = computeMonitorSnapshot(convs);
    expect(snap.byDepartment).toEqual([{ name: "BR", color: "#abc", count: 2 }]);
  });
});
