import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSetupStatus } from "@/lib/env";
import { eventLoopLagMs } from "@/lib/load";

export const dynamic = "force-dynamic";

/**
 * Liveness for the host's health check. Never load-shed: under heavy load the process is busy,
 * not dead, and failing this check would make the host restart a server that is still serving.
 * Returns 503 only when the database is unusable.
 */
export async function GET() {
  const s = getSetupStatus();
  let db = true;
  try {
    getDb().prepare("SELECT 1").get();
  } catch {
    db = false;
  }
  return NextResponse.json(
    { ok: !s.configError && db, sandbox: s.sandbox, paypalMode: s.paypalMode, db: db ? "ok" : "error", lagMs: Math.round(eventLoopLagMs()) },
    { status: db ? 200 : 503 },
  );
}
