export type AlertLevel = "vermelho" | "amarelo" | "verdeAlerta" | "ok" | "respondida";

export interface SeverityInput {
  lastReceivedMessageDate: string | null;
  lastSendedMessageDate: string | null;
  now: number;
}

export function computeAlertLevel(i: SeverityInput): { level: AlertLevel; minutosParada: number } {
  if (!i.lastReceivedMessageDate) return { level: "respondida", minutosParada: 0 };
  const received = new Date(i.lastReceivedMessageDate).getTime();
  const sended = i.lastSendedMessageDate ? new Date(i.lastSendedMessageDate).getTime() : 0;
  if (sended >= received) return { level: "respondida", minutosParada: 0 };

  const minutosParada = (i.now - received) / 60_000;
  let level: AlertLevel = "ok";
  if (minutosParada > 30) level = "vermelho";
  else if (minutosParada > 10) level = "amarelo";
  else if (minutosParada > 3) level = "verdeAlerta";
  return { level, minutosParada };
}
