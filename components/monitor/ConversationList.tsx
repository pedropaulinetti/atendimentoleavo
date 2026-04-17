"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { SummaryBadges } from "./SummaryBadges";
import { Skeleton } from "@/components/ui/skeleton";

interface Conversation {
  id: string; name: string; level: "vermelho"|"amarelo"|"verdeAlerta";
  minutosParada: number; attendantName: string; departmentName: string; departmentColor: string;
}

const LEVEL_STYLES = {
  vermelho: "border-l-4 border-red-500 bg-red-50",
  amarelo: "border-l-4 border-yellow-500 bg-yellow-50",
  verdeAlerta: "border-l-4 border-green-500 bg-green-50",
};
const LEVEL_ICON = { vermelho: "🔴", amarelo: "🟡", verdeAlerta: "🟢" };

function formatMinutes(m: number) {
  if (m < 60) return `${Math.floor(m)} min sem resposta`;
  return `${Math.floor(m / 60)}h ${Math.floor(m % 60)}min sem resposta`;
}

export function ConversationList({ soundEnabled }: { soundEnabled: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const r = await fetch("/api/conversations");
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ conversations: Conversation[]; updatedAt: string }>;
    },
    refetchInterval: 10_000,
  });

  const prevReds = useRef<Set<string>>(new Set());
  const [audio] = useState(() => typeof Audio !== "undefined" ? new Audio("/sounds/alert.mp3") : null);

  useEffect(() => {
    if (!data) return;
    const currentReds = new Set(data.conversations.filter(c => c.level === "vermelho").map(c => c.id));
    if (soundEnabled && audio) {
      for (const id of currentReds) {
        if (!prevReds.current.has(id)) { audio.play().catch(() => {}); break; }
      }
    }
    prevReds.current = currentReds;
  }, [data, soundEnabled, audio]);

  if (isLoading) return <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16"/>)}</div>;
  if (error) return <div className="rounded border border-red-300 bg-red-50 p-4 text-sm">Atualização falhou. Tentando novamente…</div>;
  if (!data) return null;

  const counts = {
    red: data.conversations.filter(c => c.level === "vermelho").length,
    yellow: data.conversations.filter(c => c.level === "amarelo").length,
    green: data.conversations.filter(c => c.level === "verdeAlerta").length,
  };

  return (
    <div className="space-y-4">
      <SummaryBadges {...counts} updatedAt={data.updatedAt} />
      {data.conversations.length === 0 ? (
        <div className="rounded-lg border bg-white p-12 text-center text-zinc-500">
          Nenhuma conversa precisa de atenção
        </div>
      ) : (
        <ul className="space-y-2">
          {data.conversations.map(c => (
            <li key={c.id} className={`flex items-center justify-between rounded p-4 ${LEVEL_STYLES[c.level]}`}>
              <div className="flex items-center gap-3">
                <span className="text-lg">{LEVEL_ICON[c.level]}</span>
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-zinc-600">{formatMinutes(c.minutosParada)}</p>
                </div>
              </div>
              <div className="text-right text-sm">
                <p>{c.attendantName}</p>
                <p className="text-zinc-500" style={{ color: c.departmentColor }}>{c.departmentName}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
