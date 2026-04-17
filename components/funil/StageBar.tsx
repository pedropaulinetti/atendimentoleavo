interface Props {
  name: string;
  count: number;
  maxCount: number;
  avgDays: number;
  stuckCount: number;
}

export function StageBar({ name, count, maxCount, avgDays, stuckCount }: Props) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">{name}</h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">{count} leads</span>
          {stuckCount > 0 && <span className="text-red-600">⚠ {stuckCount} parados</span>}
        </div>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full bg-zinc-900 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Tempo médio na etapa: {avgDays.toFixed(1)} dias
      </p>
    </div>
  );
}
