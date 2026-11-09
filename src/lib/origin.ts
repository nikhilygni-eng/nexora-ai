import type { NextRequest } from "next/server";
import { UnauthorizedError } from "@/lib/api";

/** CSRF defense for state-changing routes, on top of SameSite=Lax cookies. */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients (tests, curl) still need a valid session cookie
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new UnauthorizedError("Cross-origin request blocked.");
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e;
    throw new UnauthorizedError("Cross-origin request blocked.");
  }
}
