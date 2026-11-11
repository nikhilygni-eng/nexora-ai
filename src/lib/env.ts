import "server-only";
import { z } from "zod";

export const PAYPAL_SANDBOX_URL = "https://api-m.sandbox.paypal.com";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

/** Integer env var; a blank value (e.g. `AI_MAX_RPM=` in .env.local) means "use the default". */
const intEnv = (min: number, max: number, def: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.coerce.number().int().min(min).max(max).default(def));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_BASE_URL: optionalString.transform((v) => (v ?? PAYPAL_SANDBOX_URL).replace(/\/+$/, "")),
  /** "sandbox" talks to PayPal. "mock" uses the in-process fake PayPal (dev/E2E only, always labeled). */
  PAYPAL_MODE: z.enum(["sandbox", "mock"]).default("sandbox"),
  /** Must be exactly "true" to allow a non-sandbox PayPal base URL. */
  PAYPAL_ALLOW_LIVE: optionalString,
  PAYPAL_WEBHOOK_ID: optionalString,
  AI_PROVIDER: z.enum(["freellmapi", "gemini", "mock"]).default("freellmapi"),
  GEMINI_API_KEY: optionalString,
  AI_MODEL: optionalString,
  FREELLMAPI_BASE_URL: optionalString.transform((v) => (v ?? "http://localhost:3001/v1").replace(/\/+$/, "")),
  FREELLMAPI_API_KEY: optionalString,
  FREELLMAPI_MODEL: optionalString,
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(45000),
  /** Gemini 3.x reasoning depth. Lower = faster tool calls. */
  AI_THINKING_LEVEL: z.enum(["minimal", "low", "medium", "high"]).default("low"),
  /** AI traffic gate (src/lib/ai/gate.ts): simultaneous model calls, queue size, max wait, and calls/minute (0 = off). */
  AI_MAX_CONCURRENCY: intEnv(1, 64, 4),
  AI_QUEUE_MAX: intEnv(0, 10000, 50),
  AI_QUEUE_WAIT_MS: intEnv(0, 120000, 20000),
  AI_MAX_RPM: intEnv(0, 100000, 0),
  /** Seconds to reuse AI insights for identical analytics facts (0 = no cache). */
  INSIGHTS_CACHE_SEC: intEnv(0, 86400, 600),
  APP_PASSCODE: optionalString,
  DATABASE_PATH: optionalString.transform((v) => v ?? "./data/nexora.db"),
  APP_BASE_URL: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export class ConfigError extends Error {}

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(
      "Invalid environment: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  const env = parsed.data;
  if (env.PAYPAL_BASE_URL !== PAYPAL_SANDBOX_URL && env.PAYPAL_ALLOW_LIVE !== "true") {
    throw new ConfigError(
      `Refusing to start: PAYPAL_BASE_URL is ${env.PAYPAL_BASE_URL}, not the PayPal Sandbox. ` +
        `NEXORA AI is sandbox-only. Set PAYPAL_ALLOW_LIVE=true only if you really intend this.`,
    );
  }
  if (env.NODE_ENV === "production" && (env.PAYPAL_MODE === "mock" || env.AI_PROVIDER === "mock") && process.env.NEXORA_ALLOW_MOCKS !== "true") {
    throw new ConfigError("Mock PayPal / mock AI are not allowed in production builds unless NEXORA_ALLOW_MOCKS=true (E2E only).");
  }
  cached = env;
  return env;
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}

export type SetupItem = {
  key: string;
  label: string;
  ok: boolean;
  help: string;
  required: boolean;
};

export type SetupStatus = {
  items: SetupItem[];
  paypalReady: boolean;
  aiReady: boolean;
  authReady: boolean;
  paypalMode: Env["PAYPAL_MODE"];
  aiProvider: Env["AI_PROVIDER"];
  aiModel: string;
  sandbox: boolean;
  configError?: string;
};

export function aiModelName(env: Env): string {
  if (env.AI_PROVIDER === "gemini") return env.AI_MODEL ?? "gemini-3.5-flash";
  if (env.AI_PROVIDER === "freellmapi") return env.FREELLMAPI_MODEL ?? env.AI_MODEL ?? "auto";
  return "scripted-test-provider";
}

/** Presence-only status. Never returns secret values. */
export function getSetupStatus(): SetupStatus {
  let env: Env;
  try {
    env = getEnv();
  } catch (e) {
    return {
      items: [],
      paypalReady: false,
      aiReady: false,
      authReady: false,
      paypalMode: "sandbox",
      aiProvider: "freellmapi",
      aiModel: "",
      sandbox: true,
      configError: e instanceof Error ? e.message : String(e),
    };
  }
  const paypalCreds = Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET);
  const paypalReady = env.PAYPAL_MODE === "mock" || paypalCreds;
  const aiReady =
    env.AI_PROVIDER === "mock" ||
    (env.AI_PROVIDER === "gemini" && Boolean(env.GEMINI_API_KEY)) ||
    (env.AI_PROVIDER === "freellmapi" && Boolean(env.FREELLMAPI_API_KEY));
  const items: SetupItem[] = [
    {
      key: "PAYPAL_CLIENT_ID",
      label: "PayPal Sandbox client ID",
      ok: Boolean(env.PAYPAL_CLIENT_ID),
      required: env.PAYPAL_MODE === "sandbox",
      help: "developer.paypal.com → Apps & Credentials → Sandbox → your REST app.",
    },
    {
      key: "PAYPAL_CLIENT_SECRET",
      label: "PayPal Sandbox secret",
      ok: Boolean(env.PAYPAL_CLIENT_SECRET),
      required: env.PAYPAL_MODE === "sandbox",
      help: "Same app page. Keep it in .env.local only.",
    },
    {
      key: "PAYPAL_BASE_URL",
      label: "PayPal API base URL (sandbox)",
      ok: env.PAYPAL_BASE_URL === PAYPAL_SANDBOX_URL,
      required: true,
      help: `Must be ${PAYPAL_SANDBOX_URL}.`,
    },
  ];
  if (env.AI_PROVIDER === "gemini") {
    items.push({
      key: "GEMINI_API_KEY",
      label: "Google Gemini API key",
      ok: Boolean(env.GEMINI_API_KEY),
      required: true,
      help: "aistudio.google.com → Get API key. Model is set by AI_MODEL.",
    });
  }
  if (env.AI_PROVIDER === "freellmapi") {
    items.push({
      key: "FREELLMAPI_API_KEY",
      label: "FreeLLMAPI unified key",
      ok: Boolean(env.FREELLMAPI_API_KEY),
      required: true,
      help: `OpenAI-compatible router at ${env.FREELLMAPI_BASE_URL}. Copy the unified key from its dashboard.`,
    });
  }
  items.push({
    key: "APP_PASSCODE",
    label: "App passcode",
    ok: Boolean(env.APP_PASSCODE && env.APP_PASSCODE.length >= 6),
    required: true,
    help: "At least 6 characters. Used to sign in to the workspace.",
  });
  return {
    items,
    paypalReady,
    aiReady,
    authReady: Boolean(env.APP_PASSCODE && env.APP_PASSCODE.length >= 6),
    paypalMode: env.PAYPAL_MODE,
    aiProvider: env.AI_PROVIDER,
    aiModel: aiModelName(env),
    sandbox: env.PAYPAL_BASE_URL === PAYPAL_SANDBOX_URL,
  };
}
