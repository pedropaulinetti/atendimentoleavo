export type DatePreset = "today" | "week" | "30d" | "month" | "custom";
export interface DateRange { from: string; to: string; }

function startOfDay(d: Date) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setUTCHours(23,59,59,999); return x; }

export function resolveDateRangePreset(
  p: Exclude<DatePreset, "custom">,
  ref = new Date(),
): DateRange {
  const to = endOfDay(ref).toISOString();
  if (p === "today") return { from: startOfDay(ref).toISOString(), to };
  if (p === "week") {
    const d = new Date(ref); d.setUTCDate(d.getUTCDate() - 7);
    return { from: startOfDay(d).toISOString(), to };
  }
  if (p === "30d") {
    const d = new Date(ref); d.setUTCDate(d.getUTCDate() - 30);
    return { from: startOfDay(d).toISOString(), to };
  }
  const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  return { from: d.toISOString(), to };
}
