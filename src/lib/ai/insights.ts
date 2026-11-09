import "server-only";
import { z } from "zod";
import type { Facts } from "@/lib/analytics";
import { formatMoney } from "@/lib/money";
import { getAIProvider } from ".";
import { AIProviderError, extractJson, type AIProvider } from "./provider";

/** Keys the model may cite. Each maps to a value computed from the database. */
export function factIndex(f: Facts): Record<string, string> {
  const m = (v: number) => formatMoney(v, f.primary_currency);
  const idx: Record<string, string> = {
    "totals.billed": m(f.totals.billed_minor),
    "totals.collected": m(f.totals.collected_minor),
    "totals.outstanding": m(f.totals.outstanding_minor),
    "totals.overdue": m(f.totals.overdue_minor),
    "totals.overdue_count": String(f.totals.overdue_count),
    "totals.open_count": String(f.totals.open_count),
    "totals.paid_count": String(f.totals.paid_count),
    avg_days_to_pay: f.avg_days_to_pay === null ? "n/a" : `${f.avg_days_to_pay} days`,
    collection_rate: f.collection_rate_pct === null ? "n/a" : `${f.collection_rate_pct}%`,
    "estimate.next_30d_collections": `${m(f.estimate_next_30d_collections_minor)} (Estimate)`,
    "scope.demo_count": String(f.scope.demo_count),
    "scope.paypal_count": String(f.scope.paypal_count),
  };
  f.aging.forEach((a, i) => (idx[`aging.${i}`] = `${a.bucket}: ${m(a.minor)} across ${a.count} invoice(s)`));
  f.top_clients_outstanding.forEach((c, i) => (idx[`top_client.${i}`] = `${c.client}: ${m(c.minor)} outstanding, oldest due ${c.oldest_due}`));
  f.monthly.forEach((mo) => (idx[`month.${mo.month}`] = `${mo.month}: billed ${m(mo.billed_minor)}, collected ${m(mo.collected_minor)}`));
  return idx;
}

export const InsightsSchema = z.object({
  insights: z
    .array(
      z.object({
        kind: z.enum(["risk", "opportunity", "trend"]),
        title: z.string().trim().min(3).max(90),
        detail: z.string().trim().min(10).max(420),
        metric_keys: z.array(z.string()).min(1).max(5),
      }),
    )
    .min(1)
    .max(4),
});
export type Insight = z.infer<typeof InsightsSchema>["insights"][number] & { grounded: { key: string; value: string }[] };

const SCHEMA = {
  type: "object",
  properties: {
    insights: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["risk", "opportunity", "trend"] },
          title: { type: "string" },
          detail: { type: "string" },
          metric_keys: { type: "array", items: { type: "string" } },
        },
        required: ["kind", "title", "detail", "metric_keys"],
      },
    },
  },
  required: ["insights"],
};

/** Money-like tokens in the text must appear among the cited fact values (or the whole fact set). */
function moneyTokensGrounded(text: string, allowedValues: string[]): boolean {
  const tokens = text.match(/[$€£₹¥]\s?[\d,]+(?:\.\d+)?|\b[A-Z]{3}\s?[\d,]+(?:\.\d+)?/g) ?? [];
  const norm = (s: string) => s.replace(/[^\d.]/g, "").replace(/\.0+$/, "");
  const allowed = new Set(allowedValues.flatMap((v) => (v.match(/[\d,]+(?:\.\d+)?/g) ?? []).map(norm)));
  return tokens.every((t) => allowed.has(norm(t)));
}

export async function generateInsights(facts: Facts, provider?: AIProvider): Promise<{ insights: Insight[]; dropped: number; model: string }> {
  const p = provider ?? getAIProvider();
  const idx = factIndex(facts);
  const system = [
    "You are a receivables analyst. Write 2–4 short insights for a freelancer about their invoices.",
    "Use ONLY the facts provided. Every number you write must come from a fact value. Do not compute new numbers.",
    "Cite the fact keys you used in metric_keys. If a value is labeled Estimate, call it an estimate.",
    facts.scope.demo_count > 0 ? "Some data is demo data; mention that once if relevant." : "",
    "Be concrete and actionable (e.g. who to remind). No hype. Return JSON only.",
  ].join("\n");
  const res = await p.generate({
    system,
    messages: [{ role: "user", text: "Facts (key → value):\n" + JSON.stringify(idx, null, 1) }],
    jsonSchema: { name: "insights", schema: SCHEMA },
    temperature: 0.3,
  });
  if (!res.text) throw new AIProviderError("malformed", "No insights returned");
  const parsed = InsightsSchema.safeParse(extractJson(res.text));
  if (!parsed.success) throw new AIProviderError("malformed", "Insights failed validation");

  const all = Object.values(idx);
  const out: Insight[] = [];
  let dropped = 0;
  for (const ins of parsed.data.insights) {
    const keys = ins.metric_keys.filter((k) => k in idx);
    if (!keys.length || !moneyTokensGrounded(ins.detail + " " + ins.title, all)) {
      dropped++;
      continue;
    }
    out.push({ ...ins, metric_keys: keys, grounded: keys.map((k) => ({ key: k, value: idx[k] })) });
  }
  return { insights: out, dropped, model: res.servedModel ?? p.model };
}
