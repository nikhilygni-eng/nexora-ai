import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE, timingSafeEqual } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";
import { apiError } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { DEFAULT_ORG_ID } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const rl = rateLimit(`login:${ip}`, 8, 60_000);
    if (!rl.ok) {
      return NextResponse.json({ error: { code: "rate_limited", message: `Too many attempts. Try again in ${rl.retryAfterSec}s.` } }, { status: 429 });
    }
    const env = getEnv();
    if (!env.APP_PASSCODE) return NextResponse.json({ error: { code: "setup_required", message: "APP_PASSCODE is not set." } }, { status: 503 });
    const { passcode } = z.object({ passcode: z.string().max(200) }).parse(await req.json());
    if (!timingSafeEqual(passcode, env.APP_PASSCODE)) {
      logAudit({ orgId: DEFAULT_ORG_ID, actor: "user", action: "auth.failed" });
      return NextResponse.json({ error: { code: "invalid_passcode", message: "That passcode isn't right." } }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, await createSessionToken(env.APP_PASSCODE), {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production" && !req.nextUrl.hostname.match(/^(localhost|127\.0\.0\.1)$/),
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });
    logAudit({ orgId: DEFAULT_ORG_ID, actor: "user", action: "auth.signed_in" });
    return res;
  } catch (e) {
    return apiError(e);
  }
}
