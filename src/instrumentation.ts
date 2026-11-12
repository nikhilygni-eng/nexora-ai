/** Runs once at server start. Refuses to boot against a non-sandbox PayPal URL. */
export async function register() {
  // Next.js compiles this file for both runtimes; the guarded import keeps Node-only code
  // (better-sqlite3, node:perf_hooks) out of the Edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
