import "server-only";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { getEnv } from "@/lib/env";
import { BusyError } from "@/lib/concurrency";

/**
 * Load shedding. Event-loop lag is the honest "is this process overloaded?" signal for Node:
 * when it stays high, every queued request is going to be slow anyway. Rejecting new API work
 * quickly (503 + Retry-After) keeps the process responsive and its memory bounded instead of
 * letting requests pile up until it falls over.
 */
type LagState = { h: IntervalHistogram; prev: number; last: number; timer: ReturnType<typeof setInterval> };

const g = globalThis as unknown as { __nexoraLag?: LagState };
const WINDOW_MS = 1000;

/** Starts the monitor (idempotent). Called at boot from instrumentation, and lazily otherwise. */
export function startLoadMonitor(): LagState {
  if (g.__nexoraLag) return g.__nexoraLag;
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const s: LagState = {
    h,
    prev: 0,
    last: 0,
    timer: setInterval(() => {
      s.prev = s.last;
      s.last = h.percentile(99) / 1e6; // ns → ms
      h.reset();
    }, WINDOW_MS),
  };
  s.timer.unref();
  g.__nexoraLag = s;
  return s;
}

/** p99 event-loop delay of the last completed 1s window, in ms. */
export function eventLoopLagMs(): number {
  return startLoadMonitor().last;
}

/**
 * 0 disables shedding (the default). Load tests showed a saturated Next.js process queues extra
 * connections in the kernel rather than in the event loop (lag stayed under ~600ms even at 10k users),
 * while a CPU-throttled small instance can show long lag during a single cold page render. So this is
 * opt-in, e.g. LOAD_SHED_LAG_MS=1500 on a larger instance or if handlers start doing heavy CPU work.
 */
export function shedThresholdMs(): number {
  return getEnv().LOAD_SHED_LAG_MS ?? 0;
}

/** Throws BusyError when the loop has been lagging for two consecutive windows. */
export function assertCapacity(): void {
  const threshold = shedThresholdMs();
  if (!threshold) return;
  const s = startLoadMonitor();
  if (Math.min(s.prev, s.last) > threshold) throw new BusyError("Event loop overloaded", 2);
}

/** Tests only: pretend the last two windows measured these lags. */
export function setLagForTests(prev: number, last: number) {
  const s = startLoadMonitor();
  s.prev = prev;
  s.last = last;
}
