import "server-only";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { MIGRATIONS } from "./migrations";

export type DB = Database.Database;

const globalForDb = globalThis as unknown as { __nexoraDb?: DB; __nexoraDbPath?: string };

export const DEFAULT_ORG_ID = "org_default";

export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(m.version, new Date().toISOString());
    })();
  }
  db.prepare("INSERT OR IGNORE INTO orgs (id, name, created_at) VALUES (?, ?, ?)").run(
    DEFAULT_ORG_ID,
    "My Studio",
    new Date().toISOString(),
  );
}

export function getDb(): DB {
  const file = getEnv().DATABASE_PATH;
  if (!globalForDb.__nexoraDb || globalForDb.__nexoraDbPath !== file) {
    globalForDb.__nexoraDb = openDatabase(file);
    globalForDb.__nexoraDbPath = file;
  }
  return globalForDb.__nexoraDb;
}

/** Tests: inject an in-memory DB. */
export function setDbForTests(db: DB) {
  globalForDb.__nexoraDb = db;
  globalForDb.__nexoraDbPath = getEnv().DATABASE_PATH;
}
