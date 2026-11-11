import "server-only";
import { TtlCache } from "@/lib/cache";
import type { generateInsights } from "./insights";

type InsightsResult = Awaited<ReturnType<typeof generateInsights>>;

const g = globalThis as unknown as { __nexoraInsightsCache?: TtlCache<InsightsResult> };

/** Process-wide cache of AI insights keyed by (org, scope, model, facts). */
export const insightsCache: TtlCache<InsightsResult> = (g.__nexoraInsightsCache ??= new TtlCache<InsightsResult>(100));

/** Tests: start each case with an empty cache. */
export function resetInsightsCache() {
  insightsCache.clear();
}
