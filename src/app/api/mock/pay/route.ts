import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, requireSession } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { mockMarkPaid } from "@/lib/paypal/mock";

/** Mock mode only: simulates the payer paying. Returns 404 in sandbox mode. */
export async function POST(req: NextRequest) {
  try {
    if (getEnv().PAYPAL_MODE !== "mock") return json({ error: { code: "not_found", message: "Not available" } }, { status: 404 });
    await requireSession();
    const { paypalInvoiceId } = z.object({ paypalInvoiceId: z.string() }).parse(await req.json());
    return json({ ok: mockMarkPaid(paypalInvoiceId) });
  } catch (e) {
    return apiError(e);
  }
}
