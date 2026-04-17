import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  name: string;
  count: number;
  maxCount: number;
  avgDays: number;
  stuckCount: number;
  color?: string;
}

export function StageBar({ name, count, maxCount, avgDays, stuckCount, color }: Props) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {color && (
              <span
                className="inline-block size-2.5 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
            )}
            <h3 className="font-semibold text-zinc-900">{name}</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-900 tabular-nums">
              {count} <span className="font-normal text-zinc-400">leads</span>
            </span>
            {stuckCount > 0 && (
              <Badge variant="destructive" className="text-xs gap-1">
                {stuckCount} parados
              </Badge>
            )}
          </div>
        </div>

        {/* Simple progress bar without the complex Progress component */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-zinc-900 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>

        <p className="mt-2.5 text-xs text-zinc-400">
          Tempo médio na etapa: <span className="font-medium text-zinc-600">{avgDays.toFixed(1)} dias</span>
        </p>
      </CardContent>
    </Card>
  );
}
