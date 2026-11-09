import "server-only";
import { getEnv } from "@/lib/env";
import { PayPalClient, type Fetcher } from "./client";
import { PayPalConfigError } from "./errors";
import { mockPayPalFetcher } from "./mock";
import type { InvoiceSource } from "@/lib/db/repo";

const g = globalThis as unknown as { __nexoraPayPal?: { client: PayPalClient; key: string }; __nexoraPayPalFetcher?: Fetcher };

export type PayPalHandle = { client: PayPalClient; source: InvoiceSource; mode: "sandbox" | "mock" };

export function getPayPal(): PayPalHandle {
  const env = getEnv();
  const mode = env.PAYPAL_MODE;
  if (mode === "sandbox" && (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET)) {
    throw new PayPalConfigError(
      "PayPal Sandbox isn't configured yet. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to .env.local and restart.",
    );
  }
  const key = `${mode}|${env.PAYPAL_BASE_URL}|${env.PAYPAL_CLIENT_ID ?? "mock"}`;
  if (!g.__nexoraPayPal || g.__nexoraPayPal.key !== key) {
    const client = new PayPalClient({
      baseUrl: env.PAYPAL_BASE_URL,
      clientId: env.PAYPAL_CLIENT_ID ?? "mock-client",
      clientSecret: env.PAYPAL_CLIENT_SECRET ?? "mock-secret",
      fetcher: g.__nexoraPayPalFetcher ?? (mode === "mock" ? mockPayPalFetcher : undefined),
      onCall: (r) => {
        if (env.NODE_ENV !== "test") {
          console.info(`[paypal] ${r.method} ${r.endpoint} → ${r.status}${r.debugId ? ` debug_id=${r.debugId}` : ""} (${r.durationMs}ms)`);
        }
      },
    });
    g.__nexoraPayPal = { client, key };
  }
  return { client: g.__nexoraPayPal.client, source: mode === "mock" ? "mock_paypal" : "paypal_sandbox", mode };
}

/** Tests: force a specific transport (e.g. a spy around the mock). */
export function setPayPalFetcherForTests(f: Fetcher | undefined) {
  g.__nexoraPayPalFetcher = f;
  g.__nexoraPayPal = undefined;
}
