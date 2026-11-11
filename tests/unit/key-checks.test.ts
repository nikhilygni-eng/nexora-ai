import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { checkGemini, checkPayPal, EXIT, printReport } from "../../scripts/lib/key-checks.mjs";

/**
 * The key checks that run before a Sandbox recording, against SIMULATED PayPal and Google answers.
 * No network, no real credentials. Every failure path must stop the run (exit 1), and nothing that
 * looks like a credential may ever reach the output.
 */

// Simulated values. Obviously not real; the tests assert that none of them is ever printed.
const ID = "simulated-client-id-0001";
const SECRET = "simulated-client-secret-must-never-be-printed";
const TOKEN = "simulated-access-token-must-never-be-printed";
const KEY = "simulated-gemini-key-must-never-be-printed";
const MODEL = "gemini-3.5-flash-lite";
const basicOf = (id: string, secret: string) => Buffer.from(`${id}:${secret}`).toString("base64");

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null; hasTimeout: boolean };
type Handler = (call: Call, signal: AbortSignal | null | undefined) => Response | Promise<Response>;

/** A stand-in for fetch that records every request and answers from `handler`. */
function simulate(handler: Handler) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
      hasTimeout: init?.signal instanceof AbortSignal,
    };
    calls.push(call);
    return handler(call, init?.signal);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const notJson = (status: number) => new Response("<html><body>gateway</body></html>", { status, headers: { "content-type": "text/html" } });
/** A server that never answers: it only ends when the request's own timeout aborts it. */
const hang: Handler = (_call, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
const networkDown: Handler = () => {
  throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
};

type Lines = { lines: { level: string; text: string }[] };
const output = (r: Lines) => r.lines.map((l) => l.text).join("\n");
function expectNoCredentials(r: Lines, extra: string[] = []) {
  const text = output(r);
  for (const secret of [ID, SECRET, TOKEN, KEY, basicOf(ID, SECRET), ...extra]) expect(text).not.toContain(secret);
}

/** Simulated PayPal Sandbox. Like the real one, only the matching Client ID + Secret pair gets a token. */
function paypal(overrides: { token?: Handler; list?: Handler; pair?: [string, string] } = {}) {
  const [validId, validSecret] = overrides.pair ?? [ID, SECRET];
  return simulate((call, signal) => {
    const path = new URL(call.url).pathname;
    if (path === "/v1/oauth2/token") {
      if (overrides.token) return overrides.token(call, signal);
      const matches = call.method === "POST" && call.headers.authorization === `Basic ${basicOf(validId, validSecret)}` && call.body === "grant_type=client_credentials";
      if (!matches) return json(401, { error: "invalid_client", error_description: "Client Authentication failed" }, { "paypal-debug-id": "sim-debug-401" });
      return json(
        200,
        { access_token: TOKEN, token_type: "Bearer", app_id: "APP-SIMULATED", expires_in: 32400, scope: "openid https://uri.paypal.com/services/invoicing" },
        { "paypal-debug-id": "sim-debug-token" },
      );
    }
    if (path === "/v2/invoicing/invoices") {
      if (overrides.list) return overrides.list(call, signal);
      if (call.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { name: "AUTHENTICATION_FAILURE", message: "Authentication failed" });
      return json(200, { total_items: 3, total_pages: 3, items: [] }, { "paypal-debug-id": "sim-debug-list" });
    }
    return json(404, {});
  });
}

/** Simulated Google Generative Language API. Only the right key in the x-goog-api-key header is accepted. */
function gemini(overrides: { auth?: Handler; model?: Handler } = {}) {
  const invalidKey = () => json(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } });
  return simulate((call, signal) => {
    const path = new URL(call.url).pathname;
    const authed = call.headers["x-goog-api-key"] === KEY;
    if (path === "/v1beta/models") {
      if (overrides.auth) return overrides.auth(call, signal);
      return authed ? json(200, { models: [{ name: "models/some-model" }], nextPageToken: "next" }) : invalidKey();
    }
    if (path.startsWith("/v1beta/models/")) {
      if (overrides.model) return overrides.model(call, signal);
      if (!authed) return invalidKey();
      const name = decodeURIComponent(path.slice("/v1beta/models/".length));
      return name === MODEL
        ? json(200, { name: `models/${name}`, supportedGenerationMethods: ["generateContent", "countTokens"] })
        : json(404, { error: { code: 404, message: `models/${name} is not found for API version v1beta`, status: "NOT_FOUND" } });
    }
    return json(404, {});
  });
}

describe("PayPal Sandbox key check (simulated PayPal)", () => {
  it("is ready when PayPal's OAuth accepts the pair and the app can list invoices", async () => {
    const { fetchImpl, calls } = paypal();
    const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl });
    expect(r.exitCode).toBe(EXIT.READY);
    expect(r.ready).toBe(true);
    expect(r.authenticated).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(calls[0].body).toBe("grant_type=client_credentials");
    expect(calls[1].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(output(r)).toContain("Client ID and Secret accepted by PayPal Sandbox OAuth");
    expect(output(r)).toContain("PayPal Sandbox credentials OK");
    expectNoCredentials(r);
  });

  it.each(["A-simulated-id", "BAA-simulated-id", "zz-9-simulated-id"])("lets OAuth decide, whatever the Client ID looks like (%s)", async (id) => {
    const matching = paypal({ pair: [id, SECRET] });
    const accepted = await checkPayPal({ clientId: id, clientSecret: SECRET, fetchImpl: matching.fetchImpl });
    expect(accepted.exitCode).toBe(EXIT.READY);

    const mismatched = paypal({ pair: [id, SECRET] });
    const rejected = await checkPayPal({ clientId: id, clientSecret: "a-secret-from-some-other-app", fetchImpl: mismatched.fetchImpl });
    expect(rejected.exitCode).toBe(EXIT.NOT_READY);
    expectNoCredentials(accepted, [id]);
    expectNoCredentials(rejected, [id, "a-secret-from-some-other-app"]);
  });

  it("stops when the Client ID and Secret don't match (HTTP 401), without calling the invoice API", async () => {
    const { fetchImpl, calls } = paypal();
    const r = await checkPayPal({ clientId: ID, clientSecret: "wrong-secret-value", fetchImpl });
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(r.authenticated).toBe(false);
    expect(calls).toHaveLength(1);
    expect(output(r)).toContain("HTTP 401");
    expect(output(r)).toContain("PayPal rejected this Client ID and Secret pair");
    expect(output(r)).toContain("same Sandbox REST app");
    expect(output(r)).not.toContain("credentials OK");
    expect(output(r)).not.toContain("accepted");
    expectNoCredentials(r, ["wrong-secret-value"]);
  });

  it("puts a timeout on both PayPal requests", async () => {
    const { fetchImpl, calls } = paypal();
    await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.hasTimeout)).toEqual([true, true]);
  });

  it("stops when the OAuth request gets no answer (timeout)", async () => {
    const { fetchImpl, calls } = paypal({ token: hang });
    const started = Date.now();
    const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl, timeoutMs: 40 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(r.authenticated).toBe(false);
    expect(calls).toHaveLength(1);
    expect(output(r)).toContain("timed out");
    expect(output(r)).toContain("PayPal readiness could not be established");
    expect(output(r)).not.toContain("accepted");
    expectNoCredentials(r);
  });

  it("stops when the invoice-list request gets no answer (timeout)", async () => {
    const { fetchImpl } = paypal({ list: hang });
    const started = Date.now();
    const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl, timeoutMs: 40 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(r.authenticated).toBe(true); // OAuth did succeed; Invoicing was not established
    expect(output(r)).toContain("List invoices: no answer within");
    expect(output(r)).toContain("Invoicing access could not be established");
    expect(output(r)).not.toContain("credentials OK");
    expectNoCredentials(r);
  });

  it("stops when PayPal can't be reached", async () => {
    const { fetchImpl } = paypal({ token: networkDown });
    const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl });
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(output(r)).toContain("could not connect");
    expect(output(r)).toContain("ECONNREFUSED");
    expect(output(r)).toContain("Nothing was verified");
    expect(output(r)).not.toContain("accepted");
    expectNoCredentials(r);
  });

  it.each([400, 429, 500, 503])("stops on an unexpected OAuth status (HTTP %i)", async (status) => {
    const { fetchImpl, calls } = paypal({ token: () => json(status, { error: "server_error", error_description: "simulated" }) });
    const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl });
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(calls).toHaveLength(1);
    expect(output(r)).toContain(`Unexpected HTTP ${status}`);
    expect(output(r)).not.toContain("accepted");
  });

  it("stops when OAuth answers 200 without a token, or with something unreadable", async () => {
    for (const token of [() => json(200, { token_type: "Bearer" }), () => notJson(200)]) {
      const { fetchImpl, calls } = paypal({ token });
      const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl });
      expect(r.exitCode).toBe(EXIT.NOT_READY);
      expect(calls).toHaveLength(1);
      expect(output(r)).toContain("no access token");
      expect(output(r)).not.toContain("accepted");
    }
  });

  it("stops when the app isn't allowed to use Invoicing (HTTP 403)", async () => {
    const { fetchImpl } = paypal({ list: () => json(403, { name: "NOT_AUTHORIZED", message: "Authorization failed due to insufficient permissions." }) });
    const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl });
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(r.authenticated).toBe(true);
    expect(output(r)).toContain("Enable the Invoicing feature");
    expect(output(r)).not.toContain("credentials OK");
  });

  it("stops on an unexpected or unreadable invoice-list answer", async () => {
    const failing = paypal({ list: () => json(500, { name: "INTERNAL_SERVER_ERROR", message: "simulated" }) });
    const r1 = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: failing.fetchImpl });
    expect(r1.exitCode).toBe(EXIT.NOT_READY);
    expect(output(r1)).toContain("Unexpected HTTP 500");

    const unreadable = paypal({ list: () => notJson(200) });
    const r2 = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: unreadable.fetchImpl });
    expect(r2.exitCode).toBe(EXIT.NOT_READY);
    expect(output(r2)).toContain("unreadable");
    expect(output(r2)).not.toContain("credentials OK");
  });

  it("refuses anything that isn't the Sandbox, and reports missing values, without sending a request", async () => {
    const live = paypal();
    const r1 = await checkPayPal({ clientId: ID, clientSecret: SECRET, baseUrl: "https://api-m.paypal.com", fetchImpl: live.fetchImpl });
    expect(r1.exitCode).toBe(EXIT.NOT_CONFIGURED);
    expect(output(r1)).toContain("not the Sandbox");
    expect(live.calls).toHaveLength(0);

    for (const creds of [{}, { clientId: ID }, { clientSecret: SECRET }, { clientId: "  ", clientSecret: SECRET }]) {
      const missing = paypal();
      const r = await checkPayPal({ ...creds, fetchImpl: missing.fetchImpl });
      expect(r.exitCode).toBe(EXIT.NOT_CONFIGURED);
      expect(missing.calls).toHaveLength(0);
      expectNoCredentials(r);
    }
  });

  it("never prints a credential or token, even when PayPal echoes one back", async () => {
    const echoOnReject = paypal({ token: () => json(401, { error: "invalid_client", error_description: `bad pair ${ID}:${SECRET} (${basicOf(ID, SECRET)})` }) });
    const r1 = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: echoOnReject.fetchImpl });
    expect(output(r1)).toContain("[redacted]");
    expectNoCredentials(r1);

    const echoToken = paypal({ list: () => json(500, { name: "INTERNAL_SERVER_ERROR", message: `failed for token ${TOKEN}` }) });
    const r2 = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: echoToken.fetchImpl });
    expect(output(r2)).toContain("[redacted]");
    expectNoCredentials(r2);
  });
});

describe("Gemini key check (simulated Google API)", () => {
  it("is ready when Google accepts the key and the configured model supports generateContent", async () => {
    const { fetchImpl, calls } = gemini();
    const r = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl });
    expect(r.exitCode).toBe(EXIT.READY);
    expect(r.authenticated).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.hasTimeout)).toEqual([true, true]);
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]); // read-only: nothing is generated
    expect(calls.some((c) => c.url.includes(KEY))).toBe(false); // the key goes in a header, never in the URL
    expect(calls[1].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`);
    expect(output(r)).toContain("Gemini key accepted");
    expect(output(r)).toContain("Gemini ready");
    expectNoCredentials(r);
  });

  it("uses the default model when none is set, and accepts a models/ name", async () => {
    for (const model of [undefined, "", `models/${MODEL}`]) {
      const { fetchImpl, calls } = gemini();
      const r = await checkGemini({ apiKey: KEY, model, fetchImpl });
      expect(r.exitCode).toBe(EXIT.READY);
      expect(calls[1].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`);
    }
  });

  it("stops when Google rejects the key, and never says accepted", async () => {
    const wrongKey = gemini();
    const r1 = await checkGemini({ apiKey: "some-other-key-value", model: MODEL, fetchImpl: wrongKey.fetchImpl });
    expect(r1.exitCode).toBe(EXIT.NOT_READY);
    expect(r1.authenticated).toBe(false);
    expect(wrongKey.calls).toHaveLength(1); // the model is not even asked about
    expect(output(r1)).toContain("HTTP 400");
    expect(output(r1)).toContain("Google rejected the key");
    expect(output(r1)).not.toContain("accepted");
    expectNoCredentials(r1, ["some-other-key-value"]);

    for (const status of [401, 403]) {
      const denied = gemini({ auth: () => json(status, { error: { code: status, message: "simulated", status: "PERMISSION_DENIED" } }) });
      const r = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl: denied.fetchImpl });
      expect(r.exitCode).toBe(EXIT.NOT_READY);
      expect(output(r)).toContain("Google rejected the key");
      expect(output(r)).not.toContain("accepted");
    }
  });

  it("stops on a network failure instead of passing", async () => {
    const { fetchImpl, calls } = gemini({ auth: networkDown });
    const r = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl });
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(r.authenticated).toBe(false);
    expect(calls).toHaveLength(1);
    expect(output(r)).toContain("could not connect");
    expect(output(r)).toContain("The key was not verified");
    expect(output(r)).not.toContain("accepted");
    expectNoCredentials(r);
  });

  it("stops when Google gives no answer (timeout)", async () => {
    const { fetchImpl } = gemini({ auth: hang });
    const started = Date.now();
    const r = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl, timeoutMs: 40 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(output(r)).toContain("timed out");
    expect(output(r)).not.toContain("accepted");
  });

  it.each([404, 429, 500, 503])("stops on an unexpected status from the authentication call (HTTP %i)", async (status) => {
    const { fetchImpl, calls } = gemini({ auth: () => json(status, { error: { code: status, message: "simulated", status: "UNAVAILABLE" } }) });
    const r = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl });
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(r.authenticated).toBe(false);
    expect(calls).toHaveLength(1);
    expect(output(r)).toContain(`Unexpected HTTP ${status}`);
    expect(output(r)).toContain("The key was not verified");
    expect(output(r)).not.toContain("accepted");
  });

  it("does not treat a 200 without a model list as authentication", async () => {
    for (const auth of [() => json(200, {}), () => notJson(200)]) {
      const { fetchImpl, calls } = gemini({ auth });
      const r = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl });
      expect(r.exitCode).toBe(EXIT.NOT_READY);
      expect(r.authenticated).toBe(false);
      expect(calls).toHaveLength(1);
      expect(output(r)).not.toContain("accepted");
    }
  });

  it("stops when the configured model isn't available to the key", async () => {
    const { fetchImpl, calls } = gemini();
    const r = await checkGemini({ apiKey: KEY, model: "gemini-0-not-a-model", fetchImpl });
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(r.authenticated).toBe(true); // the key itself was accepted
    expect(calls).toHaveLength(2);
    expect(output(r)).toContain("Gemini key accepted");
    expect(output(r)).toContain("gemini-0-not-a-model is not available to this key");
    expect(output(r)).not.toContain("Gemini ready");
  });

  it("stops when the model exists but can't generate content, or doesn't say", async () => {
    const embedOnly = gemini({ model: () => json(200, { name: `models/${MODEL}`, supportedGenerationMethods: ["embedContent"] }) });
    const r1 = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl: embedOnly.fetchImpl });
    expect(r1.exitCode).toBe(EXIT.NOT_READY);
    expect(output(r1)).toContain("does not support generateContent");

    const silent = gemini({ model: () => json(200, { name: `models/${MODEL}` }) });
    const r2 = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl: silent.fetchImpl });
    expect(r2.exitCode).toBe(EXIT.NOT_READY);
    expect(output(r2)).not.toContain("Gemini ready");
  });

  it("stops when the model check itself fails (network, timeout, unexpected status)", async () => {
    const cases: { model: Handler; expected: string; timeoutMs?: number }[] = [
      { model: networkDown, expected: "could not connect" },
      { model: hang, expected: "timed out", timeoutMs: 40 },
      { model: () => json(500, { error: { code: 500, message: "simulated", status: "INTERNAL" } }), expected: "Unexpected HTTP 500" },
      { model: () => json(429, { error: { code: 429, message: "simulated", status: "RESOURCE_EXHAUSTED" } }), expected: "Unexpected HTTP 429" },
    ];
    for (const c of cases) {
      const { fetchImpl } = gemini({ model: c.model });
      const r = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl, timeoutMs: c.timeoutMs });
      expect(r.exitCode).toBe(EXIT.NOT_READY);
      expect(r.authenticated).toBe(true);
      expect(output(r)).toContain(c.expected);
      expect(output(r)).not.toContain("Gemini ready");
    }
  });

  it("reports a missing key without sending a request", async () => {
    for (const apiKey of [undefined, "", "   "]) {
      const { fetchImpl, calls } = gemini();
      const r = await checkGemini({ apiKey, model: MODEL, fetchImpl });
      expect(r.exitCode).toBe(EXIT.NOT_CONFIGURED);
      expect(calls).toHaveLength(0);
    }
  });

  it("never prints the key, even when Google echoes it back", async () => {
    const { fetchImpl } = gemini({ auth: () => json(400, { error: { code: 400, message: `API key not valid: ${KEY}`, status: "INVALID_ARGUMENT" } }) });
    const r = await checkGemini({ apiKey: KEY, model: MODEL, fetchImpl });
    expect(r.exitCode).toBe(EXIT.NOT_READY);
    expect(output(r)).toContain("[redacted]");
    expectNoCredentials(r);
  });
});

/**
 * A real local HTTP server (loopback only) that answers the paths in `answers` and accepts every
 * other request without ever replying, like a provider that has stopped responding.
 */
async function withSilentServer<T>(answers: Record<string, unknown>, run: (origin: string) => Promise<T>): Promise<T> {
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path in answers) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(answers[path]));
    }
    // otherwise: say nothing, keep the connection open
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await run(origin);
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("timeouts over real HTTP, against a server that never answers", () => {
  /** Real fetch, real sockets: only the host is swapped for the local server. */
  const viaLocal = (origin: string) => ((input: RequestInfo | URL, init?: RequestInit) => fetch(String(input).replace("https://api-m.sandbox.paypal.com", origin), init)) as typeof fetch;

  it("PayPal OAuth request: gives up after the timeout and stops", async () => {
    await withSilentServer({}, async (origin) => {
      const started = Date.now();
      const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: viaLocal(origin), timeoutMs: 250 });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(r.exitCode).toBe(EXIT.NOT_READY);
      expect(r.authenticated).toBe(false);
      expect(output(r)).toContain("OAuth token: no answer within 0.25 s (timed out)");
      expectNoCredentials(r);
    });
  });

  it("PayPal invoice-list request: gives up after the timeout and stops", async () => {
    const tokenAnswer = { access_token: TOKEN, token_type: "Bearer", app_id: "APP-SIMULATED", expires_in: 32400, scope: "https://uri.paypal.com/services/invoicing" };
    await withSilentServer({ "/v1/oauth2/token": tokenAnswer }, async (origin) => {
      const started = Date.now();
      const r = await checkPayPal({ clientId: ID, clientSecret: SECRET, fetchImpl: viaLocal(origin), timeoutMs: 250 });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(r.exitCode).toBe(EXIT.NOT_READY);
      expect(r.authenticated).toBe(true);
      expect(output(r)).toContain("List invoices: no answer within 0.25 s (timed out)");
      expect(output(r)).not.toContain("credentials OK");
      expectNoCredentials(r);
    });
  });

  it("Gemini: gives up after the timeout and stops, without saying accepted", async () => {
    await withSilentServer({}, async (origin) => {
      const started = Date.now();
      const r = await checkGemini({ apiKey: KEY, model: MODEL, baseUrl: origin, timeoutMs: 250 });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(r.exitCode).toBe(EXIT.NOT_READY);
      expect(r.authenticated).toBe(false);
      expect(output(r)).toContain("Gemini authentication check: no answer within 0.25 s (timed out)");
      expect(output(r)).not.toContain("accepted");
      expectNoCredentials(r);
    });
  });
});

describe("printReport", () => {
  it("sends errors to stderr, everything else to stdout, and returns the exit code", () => {
    const seen = { log: [] as string[], warn: [] as string[], error: [] as string[] };
    const code = printReport(
      {
        exitCode: EXIT.NOT_READY,
        ready: false,
        authenticated: false,
        lines: [
          { level: "info", text: "checked" },
          { level: "warn", text: "careful" },
          { level: "error", text: "stopped" },
        ],
      },
      { log: (s) => seen.log.push(s), warn: (s) => seen.warn.push(s), error: (s) => seen.error.push(s) },
    );
    expect(code).toBe(EXIT.NOT_READY);
    expect(seen).toEqual({ log: ["checked"], warn: ["careful"], error: ["stopped"] });
  });
});
