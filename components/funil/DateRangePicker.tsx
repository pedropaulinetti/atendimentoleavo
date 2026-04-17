"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resolveDateRangePreset } from "@/lib/funil/dateRange";

export function DateRangePicker() {
  const router = useRouter();
  const sp = useSearchParams();
  const current = sp.get("preset") ?? "30d";

  function setPreset(p: "today" | "week" | "30d" | "month") {
    const r = resolveDateRangePreset(p);
    const q = new URLSearchParams({ preset: p, from: r.from, to: r.to });
    router.push(`/funil?${q.toString()}`);
  }

  const LABELS = { today: "Hoje", week: "7 dias", "30d": "30 dias", month: "Mês" };

  return (
    <div className="flex gap-2">
      {(["today", "week", "30d", "month"] as const).map(p => (
        <Button
          key={p}
          variant={current === p ? "default" : "outline"}
          size="sm"
          onClick={() => setPreset(p)}
        >
          {LABELS[p]}
        </Button>
      ))}
    </div>
  );
}
