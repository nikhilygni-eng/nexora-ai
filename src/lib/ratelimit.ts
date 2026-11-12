/**
 * In-memory sliding-window limiter (single instance deployment).
 * Memory is bounded: expired keys are pruned periodically, and the number of tracked keys is capped
 * (least-recently-used key evicted first) so a flood of unique IPs on /api/auth/login can't grow this
 * map until the process runs out of memory.
 */
type Bucket = { hits: number[]; windowMs: number };

const buckets = new Map<string, Bucket>();
export const MAX_RATE_LIMIT_KEYS = 50_000;
const PRUNE_EVERY = 1_000;
let callsSincePrune = 0;

function pruneExpired(now: number) {
  callsSincePrune = 0;
  for (const [key, b] of buckets) {
    const newest = b.hits[b.hits.length - 1];
    if (newest === undefined || now - newest >= b.windowMs) buckets.delete(key);
  }
}

/** Re-insert so Map order is least-recently-used first; evict from the front when over the cap. */
function store(key: string, bucket: Bucket) {
  buckets.delete(key);
  buckets.set(key, bucket);
  while (buckets.size > MAX_RATE_LIMIT_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number; remaining: number } {
  const now = Date.now();
  if (++callsSincePrune >= PRUNE_EVERY) pruneExpired(now);
  const hits = (buckets.get(key)?.hits ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    store(key, { hits, windowMs });
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)), remaining: 0 };
  }
  hits.push(now);
  store(key, { hits, windowMs });
  return { ok: true, retryAfterSec: 0, remaining: limit - hits.length };
}

export function rateLimitKeyCount() {
  return buckets.size;
}

export function resetRateLimits() {
  buckets.clear();
  callsSincePrune = 0;
}
