"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BigStat } from "@/components/shared/BigStat";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string; name: string; level: "vermelho"|"amarelo"|"verdeAlerta";
  minutosParada: number; attendantName: string; departmentName: string; departmentColor: string;
}

const LEVEL_CONFIG = {
  vermelho: {
    border: "border-l-red-500",
    bg: "bg-red-50/50",
    badge: "bg-red-100 text-red-700 border-red-200",
    label: "Crítico",
  },
  amarelo: {
    border: "border-l-amber-500",
    bg: "bg-amber-50/50",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    label: "Atenção",
  },
  verdeAlerta: {
    border: "border-l-emerald-500",
    bg: "bg-emerald-50/50",
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
    label: "Alerta",
  },
};

function formatTimeParada(m: number): { value: string; label: string } {
  if (m < 60) return { value: `${Math.floor(m)}min`, label: "sem resposta" };
  return { value: `${Math.floor(m / 60)}h ${Math.floor(m % 60)}min`, label: "sem resposta" };
}

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map(n => n[0]?.toUpperCase() ?? "")
    .join("");
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

  if (isLoading) return (
    <div className="space-y-2">
      {[1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl"/>)}
    </div>
  );

  if (error) return (
    <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
      Atualização falhou. Tentando novamente…
    </Card>
  );

  if (!data) return null;

  const counts = {
    red: data.conversations.filter(c => c.level === "vermelho").length,
    yellow: data.conversations.filter(c => c.level === "amarelo").length,
    green: data.conversations.filter(c => c.level === "verdeAlerta").length,
  };
  const total = counts.red + counts.yellow + counts.green;
  const updatedLabel = new Date(data.updatedAt).toLocaleTimeString("pt-BR");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <BigStat
          label="Em alerta"
          value={total}
          sublabel={`atualizado ${updatedLabel}`}
          icon={MessageSquare}
          tone="default"
        />
        <BigStat
          label="Críticas"
          value={counts.red}
          sublabel="> 30 min sem resposta"
          icon={AlertCircle}
          tone="red"
        />
        <BigStat
          label="Atenção"
          value={counts.yellow}
          sublabel="10 a 30 min"
          icon={AlertTriangle}
          tone="amber"
        />
        <BigStat
          label="Verde-alerta"
          value={counts.green}
          sublabel="3 a 10 min"
          icon={Clock}
          tone="emerald"
        />
      </div>
      {data.conversations.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="flex flex-col items-center gap-3">
            <CheckCircle2 className="size-10 text-emerald-500" />
            <div>
              <p className="font-medium text-zinc-900">Tudo em dia!</p>
              <p className="mt-1 text-sm text-zinc-500">Nenhuma conversa precisa de atenção agora.</p>
            </div>
          </div>
        </Card>
      ) : (
        <ul className="space-y-2">
          {data.conversations.map(c => {
            const cfg = LEVEL_CONFIG[c.level];
            const time = formatTimeParada(c.minutosParada);
            return (
              <li key={c.id}>
                <Card
                  className={cn(
                    "flex items-center justify-between border-l-4 px-5 py-4 transition-shadow hover:shadow-md",
                    cfg.border,
                    cfg.bg
                  )}
                >
                  <div className="flex items-center gap-4">
                    <Avatar>
                      <AvatarFallback className="text-xs font-semibold bg-zinc-200 text-zinc-700">
                        {getInitials(c.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-zinc-900 leading-tight">{c.name}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    {/* Time parada — prominent */}
                    <div className="text-right">
                      <p className="text-2xl font-semibold tabular-nums leading-none text-zinc-900">
                        {time.value}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">{time.label}</p>
                    </div>

                    {/* Department badge */}
                    <Badge
                      variant="outline"
                      className={cn("hidden sm:inline-flex shrink-0", cfg.badge)}
                    >
                      <span
                        className="mr-1.5 inline-block size-1.5 rounded-full"
                        style={{ backgroundColor: c.departmentColor }}
                      />
                      {c.departmentName}
                    </Badge>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
