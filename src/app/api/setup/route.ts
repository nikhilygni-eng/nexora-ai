import { NextResponse } from "next/server";
import { getSetupStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Presence-only checklist. Never returns secret values. */
export async function GET() {
  return NextResponse.json(getSetupStatus());
}
