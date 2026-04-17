"use client";
import { useEffect, useState } from "react";
import { ConversationList } from "@/components/monitor/ConversationList";
import { Button } from "@/components/ui/button";
import { BellRing, Volume2, VolumeX } from "lucide-react";

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Monitor de conversas</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Conversas paradas aguardando resposta</p>
        </div>
        {!activated ? (
          <Button onClick={activate} variant="outline" size="sm" className="gap-2">
            <BellRing className="size-4" />
            Ativar alertas sonoros
          </Button>
        ) : (
          <Button onClick={toggle} variant="outline" size="sm" className="gap-2">
            {soundEnabled ? (
              <><Volume2 className="size-4" /> Som ligado</>
            ) : (
              <><VolumeX className="size-4" /> Mutado</>
            )}
          </Button>
        )}
      </div>
      <ConversationList soundEnabled={soundEnabled} />
    </div>
  );
}
