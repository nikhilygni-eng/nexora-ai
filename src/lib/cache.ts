import "server-only";
import { NextResponse } from "next/server";
import { getDb, type DB } from "@/lib/db";

/**
 * Micro-cache for the dashboard's read endpoints. Under a burst (many tabs or users loading the
 * dashboard at once) the same JSON is computed once and reused, instead of re-running the
 * analytics queries and serialization for every request.
 *
 * Never stale after a write: entries are tied to SQLite's total_changes() counter for the shared
 * connection, which every INSERT/UPDATE/DELETE bumps. The short TTL only bounds date-based values
 * (e.g. "overdue" flips at midnight).
 */
type Entry = { db: DB; version: number; at: number; body: string };

const g = globalThis as unknown as { __nexoraReadCache?: Map<string, Entry>; __nexoraVersionStmt?: WeakMap<DB, { get(): unknown }> };
export const READ_CACHE_TTL_MS = 3000;
const MAX_ENTRIES = 200;

function entries() {
  return (g.__nexoraReadCache ??= new Map());
}

function dataVersion(db: DB): number {
  const stmts = (g.__nexoraVersionStmt ??= new WeakMap());
  let stmt = stmts.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT total_changes() AS n");
    stmts.set(db, stmt);
  }
  return (stmt.get() as { n: number }).n;
}

/** Returns the JSON body for `key`, recomputing only after a write or when the TTL expires. */
export function cachedJsonBody(key: string, compute: () => unknown, ttlMs = READ_CACHE_TTL_MS): string {
  const db = getDb();
  const version = dataVersion(db);
  const now = Date.now();
  const hit = entries().get(key);
  if (hit && hit.db === db && hit.version === version && now - hit.at < ttlMs) return hit.body;
  const body = JSON.stringify(compute());
  if (entries().size >= MAX_ENTRIES) entries().clear();
  entries().set(key, { db, version, at: now, body });
  return body;
}

export function cachedJson(key: string, compute: () => unknown, ttlMs?: number) {
  return new NextResponse(cachedJsonBody(key, compute, ttlMs), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function clearReadCache() {
  entries().clear();
}
