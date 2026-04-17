import { Badge } from "@/components/ui/badge";
import { AlertCircle, AlertTriangle, CheckCircle, Clock } from "lucide-react";

interface Props { red: number; yellow: number; green: number; updatedAt?: string; }

export function SummaryBadges({ red, yellow, green, updatedAt }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white px-5 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          className="gap-1.5 bg-red-100 text-red-700 border-red-200 hover:bg-red-100"
          variant="outline"
        >
          <AlertCircle className="size-3.5" />
          {red} {red === 1 ? "crítica" : "críticas"}
        </Badge>
        <Badge
          className="gap-1.5 bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100"
          variant="outline"
        >
          <AlertTriangle className="size-3.5" />
          {yellow} {yellow === 1 ? "atenção" : "atenções"}
        </Badge>
        <Badge
          className="gap-1.5 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
          variant="outline"
        >
          <CheckCircle className="size-3.5" />
          {green} verde-alerta
        </Badge>
      </div>
      {updatedAt && (
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <Clock className="size-3.5" />
          {new Date(updatedAt).toLocaleTimeString("pt-BR")}
        </span>
      )}
    </div>
  );
}
