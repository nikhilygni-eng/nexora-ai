/**
 * Small in-memory TTL cache with single-flight: concurrent requests for the same key share one
 * in-progress computation, so ten people clicking the same button cost one upstream call.
 * Failures are never cached. Single-instance by design, like the rest of the deployment.
 */
export class TtlCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(private readonly maxEntries = 200, private readonly now: () => number = Date.now) {}

  /** True when a fresh value or an in-progress computation exists for the key. */
  has(key: string): boolean {
    return this.inflight.has(key) || this.fresh(key) !== undefined;
  }

  async getOrCreate(key: string, ttlMs: number, create: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
    const hit = this.fresh(key);
    if (hit !== undefined) return { value: hit, cached: true };
    const pending = this.inflight.get(key);
    if (pending) return { value: await pending, cached: true };
    const p = create();
    this.inflight.set(key, p);
    try {
      const value = await p;
      if (ttlMs > 0) this.set(key, value, ttlMs);
      return { value, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  delete(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
    this.inflight.clear();
  }

  private fresh(key: string): T | undefined {
    const e = this.values.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return e.value;
  }

  private set(key: string, value: T, ttlMs: number) {
    if (this.values.size >= this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest !== undefined) this.values.delete(oldest);
    }
    this.values.set(key, { value, expiresAt: this.now() + ttlMs });
  }
}
