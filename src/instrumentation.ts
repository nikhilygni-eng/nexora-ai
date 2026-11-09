/** Runs once at server start. Refuses to boot against a non-sandbox PayPal URL. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getEnv, getSetupStatus } = await import("@/lib/env");
  getEnv(); // throws ConfigError → server fails to start
  const s = getSetupStatus();
  const missing = s.items.filter((i) => i.required && !i.ok).map((i) => i.key);
  console.info(`[nexora] PayPal mode=${s.paypalMode} sandbox=${s.sandbox} · AI provider=${s.aiProvider} model=${s.aiModel}`);
  if (missing.length) console.warn(`[nexora] Setup incomplete. Missing: ${missing.join(", ")} — open /setup`);
}
