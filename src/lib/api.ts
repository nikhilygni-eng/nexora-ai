import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { DEFAULT_ORG_ID } from "@/lib/db";
import { getEnv, ConfigError } from "@/lib/env";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { AIProviderError } from "@/lib/ai/provider";
import { PayPalApiError, PayPalConfigError, PayPalNetworkError } from "@/lib/paypal/errors";
import { ApprovalConflictError, ApprovalValidationError, ExecutionError, NotFoundError } from "@/lib/invoices/service";

export type Session = { orgId: string };

export class UnauthorizedError extends Error {
  status = 401;
}

/** Every API route resolves the org from the session; all queries are org-scoped. */
export async function requireSession(): Promise<Session> {
  const env = getEnv();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token, env.APP_PASSCODE))) throw new UnauthorizedError("Sign in to continue.");
  return { orgId: DEFAULT_ORG_ID };
}

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function apiError(err: unknown) {
  const body = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    NextResponse.json({ error: { code, message, ...extra } }, { status });
  if (err instanceof UnauthorizedError) return body(401, "unauthorized", err.message);
  if (err instanceof ZodError) return body(400, "invalid_request", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (err instanceof ApprovalConflictError) return body(409, "conflict", err.message);
  if (err instanceof ApprovalValidationError) return body(422, "invalid", err.message);
  if (err instanceof NotFoundError) return body(404, "not_found", err.message);
  if (err instanceof ExecutionError) return body(502, "paypal_error", err.message, { debugId: err.debugId });
  if (err instanceof PayPalConfigError) return body(503, "paypal_not_configured", err.message);
  if (err instanceof PayPalApiError) return body(502, "paypal_error", err.userMessage, { debugId: err.debugId });
  if (err instanceof PayPalNetworkError) return body(504, "paypal_unreachable", err.userMessage);
  if (err instanceof AIProviderError) {
    // Server-side diagnostics only (provider messages never contain our keys); the client gets a generic message.
    console.warn(`[ai] ${err.kind}: ${err.message.slice(0, 300)}`);
    const status = err.kind === "not_configured" ? 503 : err.kind === "rate_limited" ? 429 : err.kind === "timeout" ? 504 : 502;
    return body(status, `ai_${err.kind}`, err.userMessage);
  }
  if (err instanceof ConfigError) return body(500, "config_error", err.message);
  console.error("[api] unhandled", err);
  return body(500, "internal", "Something went wrong on the server. Check the server logs.");
}
