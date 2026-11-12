import type { NextRequest } from "next/server";
import { z } from "zod";
import { runAgent } from "@/lib/ai/agent";
import { apiError, json, requireSession } from "@/lib/api";
import { withAISlot } from "@/lib/concurrency";
import { getProposal, latestConversation, listMessages, listProposals } from "@/lib/db/repo";
import { rateLimit } from "@/lib/ratelimit";
import { proposalDTO } from "@/lib/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  conversationId: z.string().max(64).nullish(),
  message: z.string().trim().min(1, "Type a request").max(2000, "Keep requests under 2000 characters"),
});

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireSession();
    const rl = rateLimit(`agent:${orgId}`, 20, 60_000);
    if (!rl.ok) {
      return json({ error: { code: "rate_limited", message: `Slow down a little — try again in ${rl.retryAfterSec}s.` } }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    }
    const body = Body.parse(await req.json());
    const result = await withAISlot(() => runAgent({ orgId, conversationId: body.conversationId, message: body.message }));
    return json({
      ...result,
      proposals: result.proposalIds.map((id) => getProposal(orgId, id)).filter(Boolean).map((p) => proposalDTO(p!)),
    });
  } catch (e) {
    return apiError(e);
  }
}

/** Visible transcript for the Command Center (user/assistant text + proposals). */
export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireSession();
    const cid = req.nextUrl.searchParams.get("conversationId") || latestConversation(orgId);
    if (!cid) return json({ conversationId: null, messages: [], proposals: [] });
    const msgs = listMessages(orgId, cid)
      .map((m) => ({ role: m.role, at: m.created_at, content: JSON.parse(m.content_json) as { text?: string; toolCalls?: { name: string }[] } }))
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.text && !(m.content.toolCalls?.length))
      .map((m) => ({ role: m.role, text: m.content.text!, at: m.at }));
    return json({ conversationId: cid, messages: msgs, proposals: listProposals(orgId, { conversationId: cid }).map(proposalDTO).reverse() });
  } catch (e) {
    return apiError(e);
  }
}
