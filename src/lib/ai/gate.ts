/**
 * Process-wide traffic gate for LLM calls.
 *
 * Without it, every concurrent user request goes straight to the provider, and a burst of
 * traffic turns into a wall of 429s from the free tier. With it:
 *   - at most `maxConcurrent` provider calls run at once; the rest wait in a FIFO queue
 *   - call starts are paced to `rpm` per rolling minute (0 = no pacing), matching the provider quota
 *   - a provider 429 pauses new starts for the provider's retry delay instead of hammering it
 *   - an exhausted daily quota fails fast for a while instead of spending a request per user
 *   - when the queue is full, or a caller would wait longer than `maxWaitMs`, the request is shed
 *     immediately with a "busy" error (HTTP 503 + Retry-After) — the server never piles up work
 *
 * Single-instance by design (matches the SQLite deployment). A multi-instance deployment would
 * move this state to Redis; the GatedProvider interface stays the same.
 */
import { AIProviderError, type AIProvider, type GenerateRequest, type GenerateResult } from "./provider";

export type GateOptions = {
  /** Simultaneous provider calls. */
  maxConcurrent: number;
  /** Callers allowed to wait for a slot. Beyond this, requests are shed. */
  maxQueue: number;
  /** Longest a caller waits (queue + pacing) before it is shed. */
  maxWaitMs: number;
  /** Max call starts per rolling 60 s. 0 disables pacing. */
  rpm: number;
  /** How long to fail fast after a daily-quota error. */
  dailyQuotaBackoffMs?: number;
  now?: () => number;
};

export type GateStats = {
  active: number;
  queued: number;
  maxConcurrent: number;
  rpmLimit: number;
  startsLastMinute: number;
  cooldownSec: number;
  dailyQuotaExhausted: boolean;
  served: number;
  shed: number;
};

type Waiter = { resolve: () => void; reject: (e: Error) => void; cleanup: () => void };

const MINUTE = 60_000;

export class AIGate {
  private active = 0;
  private readonly waiters: Waiter[] = [];
  private starts: number[] = [];
  private cooldownUntil = 0;
  private dailyError: { until: number; error: AIProviderError } | null = null;
  private served = 0;
  private shed = 0;

  constructor(private readonly o: GateOptions) {}

  private now() {
    return this.o.now ? this.o.now() : Date.now();
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.dailyError && this.now() < this.dailyError.until) throw this.dailyError.error;
    const deadline = this.now() + this.o.maxWaitMs;
    await this.acquire(deadline, signal);
    try {
      await this.pace(deadline, signal);
      this.served++;
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Called when the provider answers 429. */
  noteRateLimited(err: AIProviderError) {
    if (err.quota?.daily) {
      this.dailyError = { until: this.now() + (this.o.dailyQuotaBackoffMs ?? 10 * MINUTE), error: err };
      return;
    }
    const sec = Math.min(Math.max(err.quota?.retryAfterSec ?? 5, 1), 60);
    this.cooldownUntil = Math.max(this.cooldownUntil, this.now() + sec * 1000);
  }

  stats(): GateStats {
    const now = this.now();
    this.prune(now);
    return {
      active: this.active,
      queued: this.waiters.length,
      maxConcurrent: this.o.maxConcurrent,
      rpmLimit: this.o.rpm,
      startsLastMinute: this.starts.length,
      cooldownSec: Math.max(0, Math.ceil((this.cooldownUntil - now) / 1000)),
      dailyQuotaExhausted: Boolean(this.dailyError && now < this.dailyError.until),
      served: this.served,
      shed: this.shed,
    };
  }

  private busy(waitMs: number): AIProviderError {
    this.shed++;
    return new AIProviderError("busy", "AI gate is saturated", { retryAfterSec: Math.min(Math.max(Math.ceil(waitMs / 1000), 2), 60) });
  }

  private acquire(deadline: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new AIProviderError("timeout", "Request aborted before it started"));
    if (this.active < this.o.maxConcurrent && this.waiters.length === 0) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiters.length >= this.o.maxQueue) return Promise.reject(this.busy(5000));
    return new Promise<void>((resolve, reject) => {
      const waitMs = Math.max(0, deadline - this.now());
      const onAbort = () => {
        remove();
        reject(new AIProviderError("timeout", "Request aborted while queued"));
      };
      const timer = setTimeout(() => {
        remove();
        reject(this.busy(5000));
      }, waitMs);
      const waiter: Waiter = {
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        },
      };
      const remove = () => {
        waiter.cleanup();
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private release() {
    const next = this.waiters.shift();
    if (next) {
      next.cleanup();
      next.resolve(); // hand the slot over directly; `active` is unchanged
    } else {
      this.active--;
    }
  }

  private prune(now: number) {
    while (this.starts.length && now - this.starts[0] >= MINUTE) this.starts.shift();
  }

  /**
   * Wait (holding the slot, so order is preserved) until a call may start under the RPM and cooldown limits,
   * then record the start. Check and record happen in the same synchronous step, so concurrent callers
   * can't both squeeze into the last RPM slot.
   */
  private async pace(deadline: number, signal?: AbortSignal) {
    for (;;) {
      const now = this.now();
      this.prune(now);
      let wakeAt = Math.max(now, this.cooldownUntil);
      if (this.o.rpm > 0 && this.starts.length >= this.o.rpm) wakeAt = Math.max(wakeAt, this.starts[0] + MINUTE);
      if (wakeAt <= now) {
        this.starts.push(now);
        return;
      }
      if (wakeAt > deadline) throw this.busy(wakeAt - now);
      await sleep(wakeAt - now, signal);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AIProviderError("timeout", "Request aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AIProviderError("timeout", "Request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Routes every provider call through the gate and feeds 429s back into it. */
export class GatedProvider implements AIProvider {
  constructor(private readonly inner: AIProvider, private readonly gate: AIGate) {}
  get id() {
    return this.inner.id;
  }
  get model() {
    return this.inner.model;
  }
  generate(req: GenerateRequest): Promise<GenerateResult> {
    return this.gate.run(async () => {
      try {
        return await this.inner.generate(req);
      } catch (e) {
        if (e instanceof AIProviderError && e.kind === "rate_limited") this.gate.noteRateLimited(e);
        throw e;
      }
    }, req.signal);
  }
}
