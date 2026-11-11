import { NextResponse } from "next/server";
import { getAIGateStats } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { getSetupStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Liveness + readiness for Render's health check and the uptime workflow.
 * Cheap on purpose: one local SQLite query, no PayPal or AI calls. Exposes counters, never secrets.
 * Returns 503 only when the database is unusable, so the host restarts a broken instance
 * but doesn't restart-loop an instance that is merely missing setup values.
 */
export async function GET() {
  const s = getSetupStatus();
  let db: "ok" | "error" | "skipped" = "skipped";
  if (!s.configError) {
    try {
      getDb().prepare("SELECT 1").get();
      db = "ok";
    } catch (e) {
      db = "error";
      console.error("[health] database check failed", (e as Error).message);
    }
  }
  return NextResponse.json(
    {
      ok: !s.configError && db === "ok",
      sandbox: s.sandbox,
      paypalMode: s.paypalMode,
      setupComplete: s.paypalReady && s.aiReady && s.authReady,
      db,
      ai: getAIGateStats(),
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    },
    { status: db === "error" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
  );
}
