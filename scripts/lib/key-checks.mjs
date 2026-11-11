/**
 * Read-only readiness checks for the keys NEXORA needs. Used by scripts/check-paypal.mjs and
 * scripts/check-gemini.mjs, and by tests/unit/key-checks.test.ts, which simulates every failure path.
 *
 * Rules these checks follow:
 *  - Every request has an explicit timeout.
 *  - "Ready" (exit 0) only when readiness was actually established. A network failure, a timeout,
 *    an unexpected HTTP status, an unreadable answer or an unavailable model is "not ready" (exit 1).
 *    Nothing is skipped or assumed.
 *  - Credentials are validated by the provider itself (PayPal OAuth, an authenticated Google call),
 *    never judged by how a value looks.
 *  - Output never contains a credential or token, even if the provider echoes one back.
 *
 * What they do NOT prove: that Gemini can generate with the model, or that PayPal can create and
 * send an invoice. Only a real run proves those.
 */

export const PAYPAL_SANDBOX_URL = "https://api-m.sandbox.paypal.com";
export const GEMINI_API_URL = "https://generativelanguage.googleapis.com";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_TIMEOUT_MS = 20_000;

/** Exit codes: 0 = ready, 1 = checked and not ready, 2 = not configured (nothing was sent). */
export const EXIT = Object.freeze({ READY: 0, NOT_READY: 1, NOT_CONFIGURED: 2 });

/**
 * @typedef {{ level: "info" | "warn" | "error", text: string }} ReportLine
 * @typedef {{ exitCode: number, ready: boolean, authenticated: boolean, lines: ReportLine[] }} Report
 */

/** Collects output lines and strips any secret value from them before they can be printed. */
function createReport() {
  /** @type {string[]} */
  const secrets = [];
  /** @type {ReportLine[]} */
  const lines = [];
  /** @param {unknown} text */
  const clean = (text) => secrets.reduce((t, s) => t.split(s).join("[redacted]"), String(text));
  return {
    lines,
    /** @param {...unknown} values */
    hide(...values) {
      for (const v of values) if (typeof v === "string" && v.length >= 4 && !secrets.includes(v)) secrets.push(v);
    },
    /** @param {unknown} text */
    info: (text) => void lines.push({ level: "info", text: clean(text) }),
    /** @param {unknown} text */
    warn: (text) => void lines.push({ level: "warn", text: clean(text) }),
    /** @param {unknown} text */
    error: (text) => void lines.push({ level: "error", text: clean(text) }),
    /**
     * @param {number} exitCode
     * @param {boolean} authenticated
     * @returns {Report}
     */
    done: (exitCode, authenticated) => ({ exitCode, ready: exitCode === EXIT.READY, authenticated, lines }),
  };
}

/**
 * One request with an explicit timeout. Never throws: a network failure or timeout comes back as
 * `failure`, described without the URL or any header.
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @returns {Promise<{ res: Response, body: any, failure?: undefined } | { failure: string, res?: undefined, body?: undefined }>}
 */
async function request(fetchImpl, url, init, timeoutMs) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { failure: describeFailure(e, timeoutMs) };
  }
  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    const name = /** @type {{ name?: string }} */ (e)?.name;
    if (name === "TimeoutError" || name === "AbortError") return { failure: describeFailure(e, timeoutMs) };
    body = null; // not JSON; callers decide what an unreadable answer means
  }
  return { res, body };
}

/**
 * @param {unknown} e
 * @param {number} timeoutMs
 */
function describeFailure(e, timeoutMs) {
  const err = /** @type {{ name?: string, cause?: { code?: string } }} */ (e) ?? {};
  if (err.name === "TimeoutError" || err.name === "AbortError") return `no answer within ${timeoutMs / 1000} s (timed out)`;
  const code = typeof err.cause?.code === "string" ? `, ${err.cause.code}` : "";
  return `could not connect (${err.name ?? "network error"}${code})`;
}

/**
 * PayPal Sandbox: is this Client ID + Secret a working pair from one Sandbox REST app, and may that
 * app use Invoicing? Read-only: creates nothing, sends nothing, moves no money.
 *   1. OAuth2 client-credentials token. PayPal itself decides whether the pair is valid and matches.
 *   2. GET /v2/invoicing/invoices?page_size=1 with that token. Proves the app has Invoicing access.
 *
 * @param {{ clientId?: string, clientSecret?: string, baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<Report>}
 */
export async function checkPayPal({ clientId, clientSecret, baseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const out = createReport();
  const base = String(baseUrl || PAYPAL_SANDBOX_URL).replace(/\/+$/, "");
  const id = clientId?.trim();
  const secret = clientSecret?.trim();

  if (base !== PAYPAL_SANDBOX_URL) {
    out.error(`Refusing: PAYPAL_BASE_URL is ${base}, not the Sandbox.`);
    return out.done(EXIT.NOT_CONFIGURED, false);
  }
  if (!id || !secret) {
    out.error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not set.");
    out.error("Get them at developer.paypal.com → Apps & Credentials → Sandbox → (your REST app).");
    return out.done(EXIT.NOT_CONFIGURED, false);
  }
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  out.hide(id, secret, basic);

  // 1. OAuth. This is the only test of the pair: no guessing from what the values look like.
  const token = await request(
    fetchImpl,
    `${base}/v1/oauth2/token`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "grant_type=client_credentials",
    },
    timeoutMs,
  );
  if (token.failure) {
    out.error(`OAuth token: ${token.failure}.`);
    out.error("  → PayPal readiness could not be established. Nothing was verified.");
    return out.done(EXIT.NOT_READY, false);
  }
  const tokenJson = token.body ?? {};
  out.hide(tokenJson.access_token);
  out.info(`OAuth token: HTTP ${token.res.status} debug_id=${token.res.headers.get("paypal-debug-id") ?? "-"}`);
  if (token.res.status === 401) {
    out.error(`  ${tokenJson.error ?? "unauthorized"}: ${tokenJson.error_description ?? "no description"}`);
    out.error("  → PayPal rejected this Client ID and Secret pair. Both must be copied from the same Sandbox REST app");
    out.error("    (developer.paypal.com → Apps & Credentials → Sandbox), with no spaces or missing characters.");
    return out.done(EXIT.NOT_READY, false);
  }
  if (!token.res.ok) {
    out.error(`  ${tokenJson.error ?? "error"}: ${tokenJson.error_description ?? "no description"}`);
    out.error(`  → Unexpected HTTP ${token.res.status} from PayPal OAuth. PayPal readiness could not be established.`);
    return out.done(EXIT.NOT_READY, false);
  }
  if (typeof tokenJson.access_token !== "string" || !tokenJson.access_token) {
    out.error("  → HTTP 200 but the answer contained no access token. PayPal readiness could not be established.");
    return out.done(EXIT.NOT_READY, false);
  }
  const scopes = String(tokenJson.scope ?? "");
  out.info(`  Client ID and Secret accepted by PayPal Sandbox OAuth (app_id=${tokenJson.app_id ?? "-"}, token expires in ${tokenJson.expires_in ?? "?"} s)`);
  out.info(`  invoicing scope present: ${/invoicing/i.test(scopes) ? "yes" : "NOT FOUND in token scopes"}`);

  // 2. Invoicing access, with the token PayPal just issued.
  const list = await request(
    fetchImpl,
    `${base}/v2/invoicing/invoices?page=1&page_size=1&total_required=true`,
    { method: "GET", headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: "application/json" } },
    timeoutMs,
  );
  if (list.failure) {
    out.error(`List invoices: ${list.failure}.`);
    out.error("  → The keys were accepted, but Invoicing access could not be established.");
    return out.done(EXIT.NOT_READY, true);
  }
  const listJson = list.body ?? {};
  out.info(`List invoices: HTTP ${list.res.status} debug_id=${list.res.headers.get("paypal-debug-id") ?? "-"}`);
  if (!list.res.ok) {
    out.error(`  ${listJson.name ?? "error"}: ${listJson.message ?? ""}`);
    if (list.res.status === 403) out.error("  → Enable the Invoicing feature for this Sandbox app (App settings → Features).");
    else out.error(`  → Unexpected HTTP ${list.res.status}. The keys were accepted, but Invoicing access could not be established.`);
    return out.done(EXIT.NOT_READY, true);
  }
  if (list.body === null || typeof list.body !== "object") {
    out.error("  → HTTP 200 but the answer was unreadable. Invoicing access could not be established.");
    return out.done(EXIT.NOT_READY, true);
  }
  out.info(`  total invoices on this sandbox account: ${listJson.total_items ?? "?"}`);
  out.info("PayPal Sandbox credentials OK (read-only check; nothing was created).");
  return out.done(EXIT.READY, true);
}

/**
 * Gemini: does Google accept this API key, and is the configured model available to it?
 * Read-only: two GET requests; generates nothing and uses no generation quota.
 *   1. GET /v1beta/models?pageSize=1. An authenticated call: 200 means Google accepted the key.
 *   2. GET /v1beta/models/<model>. The model must exist for this key and support generateContent.
 * The key travels in a header, never in the URL.
 *
 * @param {{ apiKey?: string, model?: string, baseUrl?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<Report>}
 */
export async function checkGemini({ apiKey, model, baseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const out = createReport();
  const base = String(baseUrl || GEMINI_API_URL).replace(/\/+$/, "");
  const key = apiKey?.trim();
  const name = (model?.trim() || DEFAULT_GEMINI_MODEL).replace(/^models\//, "");

  if (!key) {
    out.error("GEMINI_API_KEY is not set.");
    out.error("Get one at aistudio.google.com → Get API key.");
    return out.done(EXIT.NOT_CONFIGURED, false);
  }
  out.hide(key);
  const headers = { "x-goog-api-key": key, Accept: "application/json" };

  // 1. Authentication.
  const auth = await request(fetchImpl, `${base}/v1beta/models?pageSize=1`, { method: "GET", headers }, timeoutMs);
  if (auth.failure) {
    out.error(`Gemini authentication check: ${auth.failure}.`);
    out.error("  → Gemini readiness could not be established. The key was not verified.");
    return out.done(EXIT.NOT_READY, false);
  }
  out.info(`Gemini authentication check: HTTP ${auth.res.status}`);
  if (auth.res.status === 400 || auth.res.status === 401 || auth.res.status === 403) {
    out.error(`  ${auth.body?.error?.status ?? "error"}: ${String(auth.body?.error?.message ?? "no description").slice(0, 200)}`);
    out.error("  → Google rejected the key. Create one at aistudio.google.com → Get API key and copy it without spaces.");
    return out.done(EXIT.NOT_READY, false);
  }
  if (!auth.res.ok) {
    out.error(`  ${auth.body?.error?.status ?? "error"}: ${String(auth.body?.error?.message ?? "no description").slice(0, 200)}`);
    out.error(`  → Unexpected HTTP ${auth.res.status} from Google. Gemini readiness could not be established. The key was not verified.`);
    return out.done(EXIT.NOT_READY, false);
  }
  if (!Array.isArray(auth.body?.models)) {
    out.error("  → HTTP 200 but the answer contained no model list. The key was not verified.");
    return out.done(EXIT.NOT_READY, false);
  }
  out.info("Gemini key accepted: Google authenticated it (read-only check; nothing was generated).");

  // 2. The configured model.
  const info = await request(fetchImpl, `${base}/v1beta/models/${encodeURIComponent(name)}`, { method: "GET", headers }, timeoutMs);
  if (info.failure) {
    out.error(`Model ${name}: ${info.failure}.`);
    out.error("  → The key works, but whether this model is available could not be established.");
    return out.done(EXIT.NOT_READY, true);
  }
  out.info(`Model ${name}: HTTP ${info.res.status}`);
  if (info.res.status === 404) {
    out.error(`  → ${name} is not available to this key. Set AI_MODEL to a model this key can use.`);
    return out.done(EXIT.NOT_READY, true);
  }
  if (!info.res.ok) {
    out.error(`  ${info.body?.error?.status ?? "error"}: ${String(info.body?.error?.message ?? "no description").slice(0, 200)}`);
    out.error(`  → Unexpected HTTP ${info.res.status}. The key works, but whether ${name} is available could not be established.`);
    return out.done(EXIT.NOT_READY, true);
  }
  const methods = info.body?.supportedGenerationMethods;
  if (!Array.isArray(methods)) {
    out.error(`  → HTTP 200 but the answer didn't say what ${name} supports. Model readiness could not be established.`);
    return out.done(EXIT.NOT_READY, true);
  }
  if (!methods.includes("generateContent")) {
    out.error(`  → ${name} exists for this key but does not support generateContent, which NEXORA needs.`);
    return out.done(EXIT.NOT_READY, true);
  }
  out.info(`  ${name}: available to this key and supports generateContent.`);
  out.info("Gemini ready (key accepted, model available). Generation itself is only proven by a real run.");
  return out.done(EXIT.READY, true);
}

/**
 * Print a report (info → stdout, warnings and errors → stderr) and return its exit code.
 * @param {Report} report
 * @param {{ log?: (s: string) => void, warn?: (s: string) => void, error?: (s: string) => void }} [io]
 */
export function printReport(report, io = console) {
  for (const line of report.lines) {
    if (line.level === "error") (io.error ?? console.error)(line.text);
    else if (line.level === "warn") (io.warn ?? console.warn)(line.text);
    else (io.log ?? console.log)(line.text);
  }
  return report.exitCode;
}
