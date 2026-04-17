"use client";
import { differenceInDays, parseISO } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

interface Deal { id: string; name: string; createdAt: string; lastMovedAt: string | null; value: number | null; }

export function DealsDrawer({ stageName, deals, onClose }: { stageName: string; deals: Deal[]; onClose: () => void; }) {
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-lg font-semibold">{stageName}</SheetTitle>
          <SheetDescription>
            {deals.length === 0
              ? "Nenhum lead nesta etapa"
              : `${deals.length} ${deals.length === 1 ? "lead" : "leads"} nesta etapa`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {deals.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">Nenhum lead nesta etapa.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs font-medium uppercase tracking-wide text-zinc-400">
                  <th className="pb-3">Nome</th>
                  <th className="pb-3">Tempo</th>
                  <th className="pb-3 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {deals.map(d => {
                  const anchor = parseISO(d.lastMovedAt ?? d.createdAt);
                  const days = differenceInDays(new Date(), anchor);
                  return (
                    <tr key={d.id} className="group">
                      <td className="py-3 pr-4 font-medium text-zinc-900 group-hover:text-zinc-700">
                        {d.name}
                      </td>
                      <td className="py-3 pr-4">
                        {days > 7 ? (
                          <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700 text-xs">
                            {days} dias
                          </Badge>
                        ) : (
                          <span className="text-zinc-500 tabular-nums">{days} dias</span>
                        )}
                      </td>
                      <td className="py-3 text-right text-zinc-500 tabular-nums">
                        {d.value ? `R$ ${d.value.toLocaleString("pt-BR")}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
