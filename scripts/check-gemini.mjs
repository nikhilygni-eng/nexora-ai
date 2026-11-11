#!/usr/bin/env node
/**
 * READ-ONLY Gemini API key check. Two GET requests; generates nothing and uses no generation quota.
 *   1. An authenticated call: Google decides whether the key is valid.
 *   2. The configured model (AI_MODEL, default gemini-3.5-flash-lite) must be available to this key
 *      and support generateContent.
 * Both requests time out after 20 s. Never prints the key.
 *
 * Exit code: 0 = ready, 1 = checked and not ready (key rejected, Google unreachable, timed out,
 * unexpected answer, or model unavailable), 2 = not configured.
 * It does not prove that generation works; only a real run does.
 *
 *   npm run check:gemini
 */
import fs from "node:fs";
import { checkGemini, printReport } from "./lib/key-checks.mjs";

if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");
const report = await checkGemini({ apiKey: process.env.GEMINI_API_KEY, model: process.env.AI_MODEL });
process.exit(printReport(report));
