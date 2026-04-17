import { Suspense } from "react";
import { DateRangePicker } from "@/components/funil/DateRangePicker";
import { StageList } from "@/components/funil/StageList";
import { Skeleton } from "@/components/ui/skeleton";

export default function FunilPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Funil de vendas</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Leads por etapa do pipeline</p>
        </div>
        <Suspense fallback={null}>
          <DateRangePicker />
        </Suspense>
      </div>
      <Suspense fallback={
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      }>
        <StageList />
      </Suspense>
    </div>
  );
}
