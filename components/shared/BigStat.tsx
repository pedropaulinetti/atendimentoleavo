import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

type Tone = "default" | "red" | "amber" | "emerald" | "blue";

interface Props {
  label: string;
  value: number | string;
  sublabel?: string;
  icon?: LucideIcon;
  tone?: Tone;
  className?: string;
}

const TONES: Record<Tone, { bar: string; icon: string; value: string }> = {
  default: { bar: "", icon: "text-zinc-400", value: "text-zinc-900" },
  red: { bar: "bg-red-500", icon: "text-red-500", value: "text-red-600" },
  amber: { bar: "bg-amber-500", icon: "text-amber-500", value: "text-amber-600" },
  emerald: { bar: "bg-emerald-500", icon: "text-emerald-600", value: "text-emerald-600" },
  blue: { bar: "bg-blue-500", icon: "text-blue-500", value: "text-blue-600" },
};

export function BigStat({ label, value, sublabel, icon: Icon, tone = "default", className }: Props) {
  const t = TONES[tone];
  return (
    <Card className={cn("relative overflow-hidden px-5 py-4 shadow-sm", className)}>
      {tone !== "default" && <div className={cn("absolute left-0 top-0 h-full w-1", t.bar)} />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
          <p className={cn("mt-2 text-4xl font-semibold tabular-nums leading-none", t.value)}>{value}</p>
          {sublabel && <p className="mt-2 text-xs text-zinc-500">{sublabel}</p>}
        </div>
        {Icon && <Icon className={cn("size-5 shrink-0", t.icon)} />}
      </div>
    </Card>
  );
}
