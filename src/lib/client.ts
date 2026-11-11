"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public debugId?: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

export type ApiInit = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Give up after this long. Default 30 s for reads, 120 s for writes (AI turns can take a while). */
  timeoutMs?: number;
  /** Automatic retries on network errors and 502/503/504. Default 2 for GET, 0 otherwise (writes are never replayed blindly). */
  retries?: number;
};

const RETRYABLE_STATUS = new Set([502, 503, 504]);
/** 503s that mean "configure something", not "try again". */
const NOT_TRANSIENT = new Set(["paypal_not_configured", "setup_required", "ai_not_configured", "config_error"]);

const MSG_NETWORK = "Can't reach NEXORA right now. Check your connection and try again.";
const MSG_WAKING = "NEXORA is waking up or under heavy load. Try again in a few seconds.";
const msgTimeout = (write: boolean) =>
  write
    ? "NEXORA took too long to respond. Your request may still finish; refresh in a moment to check before trying again."
    : "NEXORA took too long to respond. Try again.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Browser fetch wrapper: JSON in/out, readable errors, redirect to login on 401,
 * a timeout on every request, and retry with backoff for idempotent reads.
 */
export async function api<T>(path: string, init?: ApiInit): Promise<T> {
  const method = init?.method ?? (init?.body !== undefined ? "POST" : "GET");
  const read = method === "GET" || method === "HEAD";
  const retries = init?.retries ?? (read ? 2 : 0);
  const timeoutMs = init?.timeoutMs ?? (read ? 30_000 : 120_000);
  for (let attempt = 0; ; attempt++) {
    try {
      return await apiOnce<T>(path, method, init, timeoutMs, read);
    } catch (e) {
      if (init?.signal?.aborted || !(e instanceof ApiError)) throw e;
      const transient = e.code === "network" || (RETRYABLE_STATUS.has(e.status) && !NOT_TRANSIENT.has(e.code));
      if (!transient || attempt >= retries) throw e;
      const backoff = [800, 2000, 4000][attempt] ?? 4000;
      await sleep(Math.min(Math.max(backoff, (e.retryAfterSec ?? 0) * 1000), 5000));
    }
  }
}

async function apiOnce<T>(path: string, method: string, init: ApiInit | undefined, timeoutMs: number, read: boolean): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const forwardAbort = () => ctl.abort();
  init?.signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: ctl.signal,
        cache: "no-store",
      });
    } catch (e) {
      if (init?.signal?.aborted) throw e; // the caller cancelled; keep the AbortError
      if (ctl.signal.aborted) throw new ApiError(0, "timeout", msgTimeout(!read));
      throw new ApiError(0, "network", MSG_NETWORK);
    }
    const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; debugId?: string } };
    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
      const retryAfter = Number(res.headers.get("Retry-After"));
      // A 5xx without our JSON error body comes from the host (cold start, proxy, overload), not from NEXORA.
      const fallback = res.status >= 502 ? MSG_WAKING : `Request failed (${res.status})`;
      throw new ApiError(
        res.status,
        data.error?.code ?? (res.status >= 502 ? "upstream" : "error"),
        data.error?.message ?? fallback,
        data.error?.debugId,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return data as T;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function fmtMoney(minor: number, currency: string) {
  const zero = ["JPY", "HUF", "TWD"].includes(currency);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: zero ? 0 : 2, maximumFractionDigits: zero ? 0 : 2 }).format(minor / (zero ? 1 : 100));
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: iso.length === 10 ? "UTC" : undefined }).format(d);
}

export function fmtRelative(iso: string) {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(iso, { month: "short", day: "numeric" });
}
