"use client";
import { LineChart, Line, CartesianGrid, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";

export interface FunilDetailPoint {
  capturedAt: string;
  totalStuck: number;
  avgStageDays: number;
}

function DetailChart({ title, points, dataKey, color, unit }: {
  title: string;
  points: FunilDetailPoint[];
  dataKey: "totalStuck" | "avgStageDays";
  color: string;
  unit?: string;
}) {
  const data = points.map(p => ({
    ...p,
    time: new Date(p.capturedAt).toLocaleString("pt-BR", {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }),
  }));
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-zinc-700">{title}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="time" fontSize={10} tickMargin={8} />
            <YAxis fontSize={10} unit={unit} />
            <Tooltip />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function FunilDetailCharts({ points }: { points: FunilDetailPoint[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <DetailChart title="Parados > 7 dias"        points={points} dataKey="totalStuck"   color="#ef4444" />
      <DetailChart title="Tempo médio nas etapas" points={points} dataKey="avgStageDays" color="#27272a" unit=" d" />
    </div>
  );
}
