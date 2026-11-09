import { NextResponse } from "next/server";
import { getSetupStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = getSetupStatus();
  return NextResponse.json({ ok: !s.configError, sandbox: s.sandbox, paypalMode: s.paypalMode });
}
