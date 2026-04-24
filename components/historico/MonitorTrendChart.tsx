"use client";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";

export interface MonitorTrendPoint {
  capturedAt: string;
  countRed: number;
  countYellow: number;
  countGreen: number;
}

export function MonitorTrendChart({ points }: { points: MonitorTrendPoint[] }) {
  const data = points.map(p => ({
    ...p,
    time: new Date(p.capturedAt).toLocaleString("pt-BR", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }),
  }));
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-zinc-700">Em alerta ao longo do tempo</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" fontSize={10} tickMargin={8} />
            <YAxis fontSize={10} />
            <Tooltip />
            <Area type="monotone" dataKey="countRed"    stackId="1" stroke="#ef4444" fill="#fecaca" name="Críticas" />
            <Area type="monotone" dataKey="countYellow" stackId="1" stroke="#f59e0b" fill="#fde68a" name="Atenção" />
            <Area type="monotone" dataKey="countGreen"  stackId="1" stroke="#10b981" fill="#a7f3d0" name="Verde-alerta" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
