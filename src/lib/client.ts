"use client";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public debugId?: string) {
    super(message);
  }
}

/** Browser fetch wrapper: JSON in/out, readable errors, redirect to login on 401. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network", "Can't reach the NEXORA server. Check that it's running.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; debugId?: string } };
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, data.error?.code ?? "error", data.error?.message ?? `Request failed (${res.status})`, data.error?.debugId);
  }
  return data as T;
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
