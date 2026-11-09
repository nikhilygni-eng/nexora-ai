import type { NextRequest } from "next/server";
import { apiError, json, requireSession } from "@/lib/api";
import { listProposals, type ProposalStatus } from "@/lib/db/repo";
import { proposalDTO } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireSession();
    const status = (req.nextUrl.searchParams.get("status") ?? undefined) as ProposalStatus | undefined;
    return json({ proposals: listProposals(orgId, { status }).map(proposalDTO) });
  } catch (e) {
    return apiError(e);
  }
}
