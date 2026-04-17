"use client";
import { differenceInDays, parseISO } from "date-fns";

interface Deal { id: string; name: string; createdAt: string; lastMovedAt: string | null; value: number | null; }

export function DealsDrawer({ stageName, deals, onClose }: { stageName: string; deals: Deal[]; onClose: () => void; }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="h-full w-full max-w-lg overflow-y-auto bg-white p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{stageName}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-900" aria-label="Fechar">✕</button>
        </div>
        {deals.length === 0 ? (
          <p className="text-sm text-zinc-500">Nenhum lead nesta etapa.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-zinc-500">
              <tr><th className="pb-2">Nome</th><th>Tempo</th><th>Valor</th></tr>
            </thead>
            <tbody>
              {deals.map(d => {
                const anchor = parseISO(d.lastMovedAt ?? d.createdAt);
                const days = differenceInDays(new Date(), anchor);
                return (
                  <tr key={d.id} className="border-b">
                    <td className="py-2">{d.name}</td>
                    <td className={days > 7 ? "text-red-600" : ""}>{days} dias</td>
                    <td>{d.value ? `R$ ${d.value.toLocaleString("pt-BR")}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </aside>
    </div>
  );
}
