import type { NextRequest } from "next/server";
import { computeFacts } from "@/lib/analytics";
import { apiError, json, requireSession } from "@/lib/api";
import { listInvoices } from "@/lib/db/repo";
import { invoiceDTO } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { orgId } = await requireSession();
    const includeDemo = req.nextUrl.searchParams.get("includeDemo") !== "false";
    return json({ facts: computeFacts(orgId, { includeDemo }), invoices: listInvoices(orgId, { includeDemo }).map(invoiceDTO) });
  } catch (e) {
    return apiError(e);
  }
}
