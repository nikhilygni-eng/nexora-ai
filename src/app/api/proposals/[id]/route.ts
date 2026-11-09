import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, requireSession } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getInvoiceByProposal, getOrg, getProposal, transitionProposal, updateProposalPayload } from "@/lib/db/repo";
import { InvoiceDraftInputSchema, normalizeInvoiceDraft, ReminderPayloadSchema } from "@/lib/invoices/schema";
import { todayISO } from "@/lib/invoices/service";
import { proposalDTO } from "@/lib/views";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { orgId } = await requireSession();
    const p = getProposal(orgId, (await params).id);
    if (!p) return json({ error: { code: "not_found", message: "Proposal not found" } }, { status: 404 });
    return json({ proposal: proposalDTO(p) });
  } catch (e) {
    return apiError(e);
  }
}

/** User edits a pending proposal. Same validation as the AI path. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const { orgId } = await requireSession();
    const id = (await params).id;
    const p = getProposal(orgId, id);
    if (!p) return json({ error: { code: "not_found", message: "Proposal not found" } }, { status: 404 });
    if (p.status !== "pending_approval" && p.status !== "failed") {
      return json({ error: { code: "conflict", message: "Only drafts awaiting approval can be edited." } }, { status: 409 });
    }
    if (p.kind === "create_and_send_invoice" && getInvoiceByProposal(orgId, id)) {
      return json(
        { error: { code: "conflict", message: "This invoice already exists in PayPal as a draft. Retry the approval instead of editing." } },
        { status: 409 },
      );
    }
    const body = await req.json();
    let payload: unknown;
    if (p.kind === "create_and_send_invoice") {
      const draft = InvoiceDraftInputSchema.parse(body.draft);
      const org = getOrg(orgId);
      const r = normalizeInvoiceDraft(draft, {
        currency: org.default_currency,
        taxName: org.default_tax_name,
        taxMilli: org.default_tax_milli,
        termsDays: org.default_terms_days,
        today: todayISO(),
      });
      if (!r.ok) {
        const msgs = [...r.missing.map((m) => `${m} is required`), ...r.errors];
        return json({ error: { code: "invalid", message: msgs.join("; "), fields: msgs } }, { status: 422 });
      }
      payload = r.invoice;
    } else {
      const cur = ReminderPayloadSchema.parse(JSON.parse(p.payload_json));
      const edit = z.object({ subject: z.string(), note: z.string() }).parse(body.reminder);
      payload = ReminderPayloadSchema.parse({ ...cur, ...edit });
    }
    // Failed proposals that were edited go back to awaiting approval.
    if (p.status === "failed") {
      transitionProposal(orgId, id, ["failed"], "pending_approval", { error: null });
    }
    if (!updateProposalPayload(orgId, id, payload)) {
      return json({ error: { code: "conflict", message: "This draft changed state. Refresh and try again." } }, { status: 409 });
    }
    logAudit({ orgId, actor: "user", action: "proposal.edited", entityType: "proposal", entityId: id });
    return json({ proposal: proposalDTO(getProposal(orgId, id)!) });
  } catch (e) {
    return apiError(e);
  }
}
