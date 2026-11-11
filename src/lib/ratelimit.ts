/** In-memory sliding-window limiter (single instance deployment). */
const buckets = new Map<string, number[]>();

/** Keys are per org or per client IP; under heavy traffic from many IPs, drop idle keys so memory stays flat. */
const MAX_KEYS = 5000;
const IDLE_MS = 10 * 60_000;

function sweep(now: number) {
  for (const [key, hits] of buckets) {
    if (!hits.length || now - hits[hits.length - 1] > IDLE_MS) buckets.delete(key);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number; remaining: number } {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) sweep(now);
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)), remaining: 0 };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, retryAfterSec: 0, remaining: limit - hits.length };
}

export function resetRateLimits() {
  buckets.clear();
}
