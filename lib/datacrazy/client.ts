import { DataCrazyError } from "./types";

const BASE = "https://api.g1.datacrazy.io/api/v1";
const TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 1_000;

function mapError(status: number): DataCrazyError {
  if (status === 401) return new DataCrazyError("UNAUTHORIZED", status, "Token Data Crazy inválido");
  if (status === 429) return new DataCrazyError("RATE_LIMIT", status, "Rate limit atingido");
  if (status >= 500) return new DataCrazyError("SERVER_ERROR", status, "Erro no Data Crazy");
  return new DataCrazyError("UNKNOWN", status, `HTTP ${status}`);
}

async function doFetch(url: string, init: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

export async function dcFetch<T = unknown>(
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const token = process.env.DATACRAZY_TOKEN;
  if (!token) throw new DataCrazyError("UNAUTHORIZED", 0, "DATACRAZY_TOKEN ausente");

  const url = new URL(BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") url.searchParams.set(k, JSON.stringify(v));
    else url.searchParams.set(k, String(v));
  }

  const init: RequestInit = {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  };

  let attempts = 0;
  while (true) {
    attempts++;
    let res: Response;
    try {
      res = await doFetch(url.toString(), init);
    } catch {
      if (attempts === 1) { await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS)); continue; }
      throw new DataCrazyError("TIMEOUT", 0, "Timeout ou erro de rede");
    }

    if (res.ok) return res.json() as Promise<T>;
    if ((res.status === 429 || res.status >= 500) && attempts === 1) {
      await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS));
      continue;
    }
    throw mapError(res.status);
  }
}
