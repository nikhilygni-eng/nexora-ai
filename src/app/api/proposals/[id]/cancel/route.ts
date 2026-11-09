import type { NextRequest } from "next/server";
import { apiError, json, requireSession } from "@/lib/api";
import { cancelProposal } from "@/lib/invoices/service";
import { assertSameOrigin } from "@/lib/origin";
import { proposalDTO } from "@/lib/views";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const { orgId } = await requireSession();
    return json({ proposal: proposalDTO(cancelProposal(orgId, (await params).id)) });
  } catch (e) {
    return apiError(e);
  }
}
