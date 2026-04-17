"use client";
import { useEffect, useState } from "react";
import { ConversationList } from "@/components/monitor/ConversationList";
import { Button } from "@/components/ui/button";

export default function MonitorPage() {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("monitor-sound");
    if (saved === "on") { setSoundEnabled(true); setActivated(true); }
  }, []);

  const activate = () => { setActivated(true); setSoundEnabled(true); localStorage.setItem("monitor-sound", "on"); };
  const toggle = () => { const v = !soundEnabled; setSoundEnabled(v); localStorage.setItem("monitor-sound", v ? "on" : "off"); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Monitor de conversas paradas</h1>
        {!activated ? (
          <Button onClick={activate} variant="outline">Clique para ativar sons</Button>
        ) : (
          <Button onClick={toggle} variant="outline">{soundEnabled ? "🔔 Som ligado" : "🔕 Mutado"}</Button>
        )}
      </div>
      <ConversationList soundEnabled={soundEnabled} />
    </div>
  );
}
