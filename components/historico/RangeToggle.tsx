"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RANGES = [
  { value: "24h", label: "24h" },
  { value: "7d",  label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
] as const;

export function RangeToggle({ active }: { active: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="inline-flex rounded-md border bg-white p-0.5 shadow-sm">
      {RANGES.map(r => (
        <Button
          key={r.value}
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = new URLSearchParams(sp);
            next.set("range", r.value);
            router.replace(`${pathname}?${next.toString()}`);
          }}
          className={cn(
            "h-8 rounded-sm px-3 text-sm",
            active === r.value ? "bg-zinc-100 font-medium" : "text-zinc-500",
          )}
        >
          {r.label}
        </Button>
      ))}
    </div>
  );
}
