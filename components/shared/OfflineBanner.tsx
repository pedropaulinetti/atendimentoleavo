"use client";
import { useEffect, useState } from "react";
export function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener("online", on); addEventListener("offline", off);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); };
  }, []);
  if (online) return null;
  return <div className="bg-amber-500 p-2 text-center text-sm text-white">Sem conexão — tentando reconectar…</div>;
}
