"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";

export interface FunilTrendPoint {
  capturedAt: string;
  totalDeals: number;
}

export function FunilTrendChart({ points }: { points: FunilTrendPoint[] }) {
  const data = points.map(p => ({
    ...p,
    time: new Date(p.capturedAt).toLocaleString("pt-BR", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }),
  }));
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-zinc-700">Leads no pipeline ao longo do tempo</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" fontSize={10} tickMargin={8} />
            <YAxis fontSize={10} />
            <Tooltip />
            <Line type="monotone" dataKey="totalDeals" stroke="#2563eb" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
