import type { NextRequest } from "next/server";
import { apiError, json, requireSession } from "@/lib/api";
import { approveProposal } from "@/lib/invoices/service";
import { assertSameOrigin } from "@/lib/origin";
import { proposalDTO } from "@/lib/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The ONLY path that performs PayPal write actions. Triggered by the user's Approve click.
 * The AI agent has no access to this endpoint or to approveProposal().
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { orgId } = await requireSession();
    const { proposal } = await approveProposal(orgId, (await params).id);
    return json({ proposal: proposalDTO(proposal) });
  } catch (e) {
    return apiError(e);
  }
}
