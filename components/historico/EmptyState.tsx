import { Card } from "@/components/ui/card";
import { LineChart } from "lucide-react";

export function EmptyState() {
  return (
    <Card className="p-12 text-center">
      <div className="flex flex-col items-center gap-3">
        <LineChart className="size-10 text-zinc-300" />
        <div>
          <p className="font-medium text-zinc-900">
            Ainda não há dados históricos para este período.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Volte em alguns minutos — snapshots são coletados a cada 15 min.
          </p>
        </div>
      </div>
    </Card>
  );
}
