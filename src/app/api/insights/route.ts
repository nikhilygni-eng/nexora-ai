import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { computeFacts } from "@/lib/analytics";
import { factIndex, generateInsights } from "@/lib/ai/insights";
import { insightsCache as cache } from "@/lib/ai/insights-cache";
import { apiError, json, requireSession } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { aiModelName, getEnv } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { orgId } = await requireSession();
    const { includeDemo, regenerate } = z
      .object({ includeDemo: z.boolean().default(true), regenerate: z.boolean().default(false) })
      .parse(await req.json().catch(() => ({})));
    const facts = computeFacts(orgId, { includeDemo });
    if (facts.scope.invoice_count === 0) return json({ insights: [], dropped: 0, facts, empty: true });

    // Same figures + same model → same answer. Reuse it instead of spending AI quota on every click.
    const env = getEnv();
    const key = createHash("sha256")
      .update(JSON.stringify({ orgId, includeDemo, model: aiModelName(env), facts: factIndex(facts) }))
      .digest("hex");
    if (regenerate) cache.delete(key);
    const ttlMs = env.INSIGHTS_CACHE_SEC * 1000;

    if (!cache.has(key)) {
      const rl = rateLimit(`insights:${orgId}`, 6, 60_000);
      if (!rl.ok) {
        return json(
          { error: { code: "rate_limited", message: `Try again in ${rl.retryAfterSec}s.` } },
          { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
        );
      }
    }
    const { value: r, cached } = await cache.getOrCreate(key, ttlMs, () => generateInsights(facts));
    if (!cached) {
      logAudit({ orgId, actor: "ai", action: "insights.generated", details: { count: r.insights.length, dropped: r.dropped, model: r.model, include_demo: includeDemo } });
    }
    return json({ ...r, facts, cached });
  } catch (e) {
    return apiError(e);
  }
}
