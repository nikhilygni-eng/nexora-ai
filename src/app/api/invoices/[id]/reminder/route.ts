import type { NextRequest } from "next/server";
import { z } from "zod";
import { draftReminderProposal } from "@/lib/ai/reminder";
import { apiError, json, requireSession } from "@/lib/api";
import { getInvoiceRow } from "@/lib/db/repo";
import { isRemindable } from "@/lib/invoices/service";
import { assertSameOrigin } from "@/lib/origin";
import { rateLimit } from "@/lib/ratelimit";
import { proposalDTO } from "@/lib/views";

export const dynamic = "force-dynamic";

/** AI drafts a reminder → proposal (pending_approval). Sending happens only via /api/proposals/[id]/approve. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { orgId } = await requireSession();
    const rl = rateLimit(`agent:${orgId}`, 20, 60_000);
    if (!rl.ok) return json({ error: { code: "rate_limited", message: `Try again in ${rl.retryAfterSec}s.` } }, { status: 429 });
    const { tone } = z.object({ tone: z.enum(["friendly", "firm"]).default("friendly") }).parse(await req.json().catch(() => ({})));
    const row = getInvoiceRow(orgId, (await params).id);
    if (!row) return json({ error: { code: "not_found", message: "Invoice not found" } }, { status: 404 });
    if (!isRemindable(row)) {
      return json(
        { error: { code: "invalid", message: row.source === "demo" ? "Demo invoices aren't in PayPal, so reminders can't be sent." : "Reminders are only possible for sent, unpaid PayPal invoices." } },
        { status: 422 },
      );
    }
    const p = await draftReminderProposal(orgId, row, tone);
    return json({ proposal: proposalDTO(p) });
  } catch (e) {
    return apiError(e);
  }
}
