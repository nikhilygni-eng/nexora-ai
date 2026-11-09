import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, requireSession } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { deleteDemoData } from "@/lib/db/repo";
import { seedDemoData } from "@/lib/invoices/demo";
import { assertSameOrigin } from "@/lib/origin";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { orgId } = await requireSession();
    const { action } = z.object({ action: z.enum(["seed", "clear"]) }).parse(await req.json());
    if (action === "seed") return json(seedDemoData(orgId));
    deleteDemoData(orgId);
    logAudit({ orgId, actor: "user", action: "demo.cleared" });
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
