import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

const PUBLIC_API = ["/api/auth/login", "/api/auth/logout", "/api/health", "/api/webhooks/paypal", "/api/setup"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  if (isApi && PUBLIC_API.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const passcode = process.env.APP_PASSCODE?.trim();
  if (!passcode) {
    if (isApi) return NextResponse.json({ error: { code: "setup_required", message: "APP_PASSCODE is not set." } }, { status: 503 });
    return NextResponse.redirect(new URL("/setup", req.url));
  }
  const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, passcode);
  if (ok) return NextResponse.next();
  if (isApi) return NextResponse.json({ error: { code: "unauthorized", message: "Sign in to continue." } }, { status: 401 });
  const url = new URL("/login", req.url);
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
};
