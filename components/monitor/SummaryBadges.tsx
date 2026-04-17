interface Props { red: number; yellow: number; green: number; updatedAt?: string; }
export function SummaryBadges({ red, yellow, green, updatedAt }: Props) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-white p-4">
      <div className="flex gap-6">
        <span className="font-medium">🔴 {red} críticas</span>
        <span className="font-medium">🟡 {yellow} atenção</span>
        <span className="font-medium">🟢 {green} verde-alerta</span>
      </div>
      {updatedAt && (
        <span className="text-xs text-zinc-500">
          Última atualização: {new Date(updatedAt).toLocaleTimeString("pt-BR")}
        </span>
      )}
    </div>
  );
}
