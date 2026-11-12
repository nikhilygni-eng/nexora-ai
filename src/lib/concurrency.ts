/**
 * In-process overload protection (the app runs as one Node process next to its SQLite file).
 *
 * - Bulkhead: caps how many slow external calls (Gemini, PayPal) run at once and how many wait.
 *   Anything beyond that is rejected immediately with BusyError → HTTP 503 + Retry-After,
 *   instead of piling up requests until the server runs out of memory or every request times out.
 * - singleFlight: concurrent callers asking for the same work share one in-flight promise.
 */

export class BusyError extends Error {
  readonly retryAfterSec: number;
  constructor(message: string, retryAfterSec = 5) {
    super(message);
    this.name = "BusyError";
    this.retryAfterSec = retryAfterSec;
  }
  get userMessage() {
    return `NEXORA is handling a lot of requests right now. Try again in ${this.retryAfterSec}s.`;
  }
}

type Waiter = { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class Bulkhead {
  private active = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    readonly name: string,
    readonly maxConcurrent: number,
    readonly maxQueue: number,
    readonly maxWaitMs: number,
  ) {}

  get stats() {
    return { active: this.active, queued: this.queue.length };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }
    if (this.queue.length >= this.maxQueue) return Promise.reject(this.busy());
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = this.queue.indexOf(waiter);
          if (i >= 0) this.queue.splice(i, 1);
          reject(this.busy());
        }, this.maxWaitMs),
      };
      this.queue.push(waiter);
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(); // the slot passes straight to the next waiter; `active` is unchanged
    } else {
      this.active--;
    }
  }

  private busy() {
    return new BusyError(`${this.name} is at capacity`, Math.max(1, Math.ceil(this.maxWaitMs / 1000)));
  }
}

/**
 * Limits for the whole process. AI turns take seconds and spend free-tier quota; PayPal calls
 * hit the Sandbox's own rate limits. Waiting is bounded so a request never hangs near the 60s route limit.
 */
export const LIMITS = {
  ai: { maxConcurrent: 4, maxQueue: 20, maxWaitMs: 15_000 },
  paypal: { maxConcurrent: 6, maxQueue: 30, maxWaitMs: 20_000 },
} as const;

type Registry = { bulkheads: Map<string, Bulkhead>; inflight: Map<string, Promise<unknown>> };
const g = globalThis as unknown as { __nexoraConcurrency?: Registry };

function registry(): Registry {
  return (g.__nexoraConcurrency ??= { bulkheads: new Map(), inflight: new Map() });
}

export function getBulkhead(name: keyof typeof LIMITS): Bulkhead {
  const r = registry();
  let b = r.bulkheads.get(name);
  if (!b) {
    const l = LIMITS[name];
    b = new Bulkhead(name === "ai" ? "The AI assistant" : "PayPal", l.maxConcurrent, l.maxQueue, l.maxWaitMs);
    r.bulkheads.set(name, b);
  }
  return b;
}

/** Run an AI turn (agent, insights, reminder draft) inside the AI bulkhead. */
export function withAISlot<T>(fn: () => Promise<T>): Promise<T> {
  return getBulkhead("ai").run(fn);
}

/** Run user-triggered PayPal work (approve, sync) inside the PayPal bulkhead. */
export function withPayPalSlot<T>(fn: () => Promise<T>): Promise<T> {
  return getBulkhead("paypal").run(fn);
}

/** Concurrent callers with the same key share one in-flight promise (e.g. 1,000 tabs polling sync → 1 sync). */
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const inflight = registry().inflight;
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  // `.then(fn)` defers fn by a microtask, so the entry is registered before fn can settle or throw.
  const p: Promise<T> = Promise.resolve()
    .then(fn)
    .finally(() => {
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** Tests only. */
export function resetConcurrencyForTests() {
  g.__nexoraConcurrency = undefined;
}
