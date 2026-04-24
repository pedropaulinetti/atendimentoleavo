import { IntercomError, type IntercomErrorCode } from "./types";

const BASE = "https://api.intercom.io";
const TIMEOUT_MS = 5_000;

function mapError(status: number): IntercomError {
  if (status === 401) return new IntercomError("UNAUTHORIZED", status, "Token Intercom inválido");
  if (status === 429) return new IntercomError("RATE_LIMIT", status, "Rate limit Intercom");
  if (status >= 500) return new IntercomError("SERVER_ERROR", status, "Erro servidor Intercom");
  return new IntercomError("UNKNOWN", status, `HTTP ${status}`);
}

export async function icFetch<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const token = process.env.INTERCOM_TOKEN;
  if (!token) throw new IntercomError("UNAUTHORIZED", 0, "INTERCOM_TOKEN ausente");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Intercom-Version": "2.11",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json() as Promise<T>;
    throw mapError(res.status);
  } catch (err) {
    if (err instanceof IntercomError) throw err;
    throw new IntercomError("TIMEOUT", 0, "Timeout ou erro de rede Intercom");
  } finally {
    clearTimeout(timer);
  }
}
