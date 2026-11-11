#!/usr/bin/env node
/**
 * READ-ONLY Gemini API key check. Lists the models the key can see; generates nothing and uses no
 * generation quota. Prints the HTTP status and whether the configured model is available.
 * Never prints the key.
 *
 *   node scripts/check-gemini.mjs
 */
import fs from "node:fs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const key = process.env.GEMINI_API_KEY?.trim();
const model = (process.env.AI_MODEL?.trim() || "gemini-3.5-flash-lite").replace(/^models\//, "");

if (!key) {
  console.error("GEMINI_API_KEY is not set.");
  console.error("Get one at aistudio.google.com → Get API key.");
  process.exit(2);
}

let res;
try {
  res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
    headers: { "x-goog-api-key": key, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
} catch (e) {
  // A network hiccup here must not block anything: the real run will show whether the key works.
  console.warn(`Gemini key check: could not reach Google (${e?.name ?? "error"}). Skipping this check.`);
  process.exit(0);
}

const body = await res.json().catch(() => ({}));
console.log(`Gemini list models: HTTP ${res.status}`);
if (res.status === 400 || res.status === 401 || res.status === 403) {
  console.error(`  ${body?.error?.status ?? "error"}: ${String(body?.error?.message ?? "").slice(0, 200)}`);
  console.error("  → Google rejected the key. Create one at aistudio.google.com → Get API key and copy it without spaces.");
  process.exit(1);
}
if (!res.ok) {
  console.warn("  Unexpected status. Skipping this check; the real run will show whether the key works.");
  process.exit(0);
}

const models = Array.isArray(body.models) ? body.models : [];
const bare = (m) => String(m?.name ?? "").replace(/^models\//, "");
const hit = models.find((m) => bare(m) === model);
const canGenerate = Boolean(hit && (hit.supportedGenerationMethods ?? []).includes("generateContent"));
console.log(`  models visible to this key: ${models.length}`);
console.log(`  ${model}: ${hit ? (canGenerate ? "available" : "listed, but without generateContent") : "NOT LISTED for this key"}`);
if (!hit) console.warn(`  → NEXORA is set to use ${model}. If the first AI step fails, set AI_MODEL to a model this key can use.`);
console.log("Gemini key accepted (read-only check; nothing was generated).");
