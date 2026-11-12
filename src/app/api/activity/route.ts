import { apiError, requireSession } from "@/lib/api";
import { listAudit } from "@/lib/audit";
import { cachedJson } from "@/lib/cache";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { orgId } = await requireSession();
    return cachedJson(`activity:${orgId}`, () => ({ entries: listAudit(orgId, 300) }));
  } catch (e) {
    return apiError(e);
  }
}
