import { Suspense } from "react";
import { DateRangePicker } from "@/components/funil/DateRangePicker";
import { StageList } from "@/components/funil/StageList";

export default function FunilPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Funil</h1>
        <Suspense fallback={null}>
          <DateRangePicker />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <StageList />
      </Suspense>
    </div>
  );
}
