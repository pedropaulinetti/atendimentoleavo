"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { resolveDateRangePreset } from "@/lib/funil/dateRange";
import { cn } from "@/lib/utils";

export function DateRangePicker() {
  const router = useRouter();
  const sp = useSearchParams();
  const current = sp.get("preset") ?? "30d";

  function setPreset(p: "today" | "week" | "30d" | "month") {
    const r = resolveDateRangePreset(p);
    const q = new URLSearchParams({ preset: p, from: r.from, to: r.to });
    router.push(`/funil?${q.toString()}`);
  }

  const LABELS: Record<string, string> = { today: "Hoje", week: "7 dias", "30d": "30 dias", month: "Mês" };

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-white p-1 shadow-sm">
      {(["today", "week", "30d", "month"] as const).map(p => (
        <Button
          key={p}
          variant="ghost"
          size="sm"
          onClick={() => setPreset(p)}
          className={cn(
            "rounded-md px-3 py-1 text-sm transition-colors",
            current === p
              ? "bg-zinc-900 text-white hover:bg-zinc-800 hover:text-white"
              : "text-zinc-500 hover:text-zinc-900"
          )}
        >
          {LABELS[p]}
        </Button>
      ))}
    </div>
  );
}
