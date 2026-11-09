import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, requireSession } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getOrg, updateOrg } from "@/lib/db/repo";
import { emailSchema } from "@/lib/invoices/schema";
import { CURRENCY_CODES, type CurrencyCode, milliToPercentString, percentToMilli } from "@/lib/money";
import { assertSameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

const view = (o: ReturnType<typeof getOrg>) => ({
  name: o.name,
  business_email: o.business_email,
  default_currency: o.default_currency,
  default_tax_name: o.default_tax_name,
  default_tax_percent: milliToPercentString(o.default_tax_milli),
  default_terms_days: o.default_terms_days,
});

export async function GET() {
  try {
    const { orgId } = await requireSession();
    return json({ settings: view(getOrg(orgId)), currencies: CURRENCY_CODES });
  } catch (e) {
    return apiError(e);
  }
}

const Patch = z.object({
  name: z.string().trim().min(1).max(80),
  business_email: z.union([emailSchema, z.literal("")]).optional(),
  default_currency: z.enum(CURRENCY_CODES as [CurrencyCode, ...CurrencyCode[]]),
  default_tax_name: z.string().trim().min(1).max(30),
  default_tax_percent: z.string().trim(),
  default_terms_days: z.coerce.number().int().min(0).max(365),
});

export async function PATCH(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const { orgId } = await requireSession();
    const p = Patch.parse(await req.json());
    let milli: number;
    try {
      milli = percentToMilli(p.default_tax_percent || "0");
    } catch (e) {
      return json({ error: { code: "invalid", message: `Tax: ${(e as Error).message}` } }, { status: 422 });
    }
    const o = updateOrg(orgId, {
      name: p.name,
      business_email: p.business_email || null,
      default_currency: p.default_currency,
      default_tax_name: p.default_tax_name,
      default_tax_milli: milli,
      default_terms_days: p.default_terms_days,
    });
    logAudit({ orgId, actor: "user", action: "settings.updated", details: view(o) });
    return json({ settings: view(o) });
  } catch (e) {
    return apiError(e);
  }
}
