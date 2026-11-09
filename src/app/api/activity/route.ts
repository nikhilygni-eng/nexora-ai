import { apiError, json, requireSession } from "@/lib/api";
import { listAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { orgId } = await requireSession();
    return json({ entries: listAudit(orgId, 300) });
  } catch (e) {
    return apiError(e);
  }
}
