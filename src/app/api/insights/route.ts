import type { NextRequest } from "next/server";
import { z } from "zod";
import { computeFacts } from "@/lib/analytics";
import { generateInsights } from "@/lib/ai/insights";
import { apiError, json, requireSession } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireSession();
    const rl = rateLimit(`insights:${orgId}`, 6, 60_000);
    if (!rl.ok) return json({ error: { code: "rate_limited", message: `Try again in ${rl.retryAfterSec}s.` } }, { status: 429 });
    const { includeDemo } = z.object({ includeDemo: z.boolean().default(true) }).parse(await req.json().catch(() => ({})));
    const facts = computeFacts(orgId, { includeDemo });
    if (facts.scope.invoice_count === 0) return json({ insights: [], dropped: 0, facts, empty: true });
    const r = await generateInsights(facts);
    logAudit({ orgId, actor: "ai", action: "insights.generated", details: { count: r.insights.length, dropped: r.dropped, model: r.model, include_demo: includeDemo } });
    return json({ ...r, facts });
  } catch (e) {
    return apiError(e);
  }
}
