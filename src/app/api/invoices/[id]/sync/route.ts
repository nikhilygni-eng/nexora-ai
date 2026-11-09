import type { NextRequest } from "next/server";
import { apiError, json, requireSession } from "@/lib/api";
import { syncInvoice } from "@/lib/invoices/service";
import { invoiceDTO } from "@/lib/views";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireSession();
    const r = await syncInvoice(orgId, (await params).id);
    return json({ invoice: invoiceDTO(r.row), changed: r.changed, skipped: "skipped" in r ? r.skipped : undefined });
  } catch (e) {
    return apiError(e);
  }
}
