import { getEnv, getSetupStatus } from "@/lib/env";
import { shedThresholdMs, startLoadMonitor } from "@/lib/load";

getEnv(); // throws ConfigError → server fails to start
const s = getSetupStatus();
const missing = s.items.filter((i) => i.required && !i.ok).map((i) => i.key);
console.info(`[nexora] PayPal mode=${s.paypalMode} sandbox=${s.sandbox} · AI provider=${s.aiProvider} model=${s.aiModel}`);
if (missing.length) console.warn(`[nexora] Setup incomplete. Missing: ${missing.join(", ")} — open /setup`);

startLoadMonitor();
const shed = shedThresholdMs();
console.info(`[nexora] Load shedding ${shed ? `on (event-loop lag > ${shed}ms)` : "off"}`);
