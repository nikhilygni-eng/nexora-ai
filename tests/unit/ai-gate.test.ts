import { afterEach, describe, expect, it, vi } from "vitest";
import { AIGate, GatedProvider } from "@/lib/ai/gate";
import { AIProviderError, type AIProvider, type GenerateRequest } from "@/lib/ai/provider";
import { apiError } from "@/lib/api";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe("AI gate", () => {
  it("caps concurrent calls and serves the queue in order", async () => {
    const gate = new AIGate({ maxConcurrent: 2, maxQueue: 10, maxWaitMs: 5000, rpm: 0 });
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const holds = Array.from({ length: 5 }, deferred);
    const runs = holds.map((h, i) =>
      gate.run(async () => {
        active++;
        peak = Math.max(peak, active);
        order.push(i);
        await h.promise;
        active--;
        return i;
      }),
    );
    await tick();
    expect(gate.stats()).toMatchObject({ active: 2, queued: 3 });
    holds.forEach((h) => h.resolve());
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(gate.stats()).toMatchObject({ active: 0, queued: 0, served: 5, shed: 0 });
  });

  it("sheds immediately when the queue is full", async () => {
    const gate = new AIGate({ maxConcurrent: 1, maxQueue: 1, maxWaitMs: 5000, rpm: 0 });
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const second = gate.run(async () => "queued");
    const third = await gate.run(async () => "never").catch((e) => e);
    expect(third).toBeInstanceOf(AIProviderError);
    expect(third.kind).toBe("busy");
    expect(third.quota.retryAfterSec).toBeGreaterThan(0);
    hold.resolve();
    await first;
    expect(await second).toBe("queued");
    expect(gate.stats().shed).toBe(1);
  });

  it("sheds a caller that would wait longer than maxWaitMs", async () => {
    const gate = new AIGate({ maxConcurrent: 1, maxQueue: 10, maxWaitMs: 30, rpm: 0 });
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const err = await gate.run(async () => "late").catch((e) => e);
    expect(err.kind).toBe("busy");
    expect(gate.stats().queued).toBe(0);
    hold.resolve();
    await first;
  });

  it("paces call starts to the RPM limit instead of failing", async () => {
    vi.useFakeTimers();
    const gate = new AIGate({ maxConcurrent: 4, maxQueue: 10, maxWaitMs: 120_000, rpm: 2, now: () => Date.now() });
    const started: number[] = [];
    const t0 = Date.now();
    const runs = [0, 1, 2].map((i) =>
      gate.run(async () => {
        started.push(Date.now() - t0);
        return i;
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toHaveLength(2); // the third call waits for the rolling minute
    expect(started[1]).toBeLessThan(1000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await Promise.all(runs)).toEqual([0, 1, 2]);
    expect(started[2]).toBeGreaterThanOrEqual(60_000);
  });

  it("sheds instead of pacing past the wait budget", async () => {
    vi.useFakeTimers();
    const gate = new AIGate({ maxConcurrent: 4, maxQueue: 10, maxWaitMs: 5_000, rpm: 1, now: () => Date.now() });
    await gate.run(async () => "ok");
    const err = await gate.run(async () => "no").catch((e) => e);
    expect(err.kind).toBe("busy");
    expect(err.quota.retryAfterSec).toBeGreaterThan(50);
  });

  it("pauses new calls after a provider 429 and fails fast on an exhausted daily quota", async () => {
    vi.useFakeTimers();
    const gate = new AIGate({ maxConcurrent: 2, maxQueue: 10, maxWaitMs: 30_000, rpm: 0, now: () => Date.now() });
    const calls: string[] = [];
    let mode: "minute" | "daily" | "ok" = "minute";
    const inner: AIProvider = {
      id: "gemini",
      model: "test-model",
      async generate() {
        calls.push(mode);
        if (mode === "minute") throw new AIProviderError("rate_limited", "per-minute", { retryAfterSec: 3 });
        if (mode === "daily") throw new AIProviderError("rate_limited", "per-day", { daily: true });
        return { text: "hi", toolCalls: [] };
      },
    };
    const p = new GatedProvider(inner, gate);
    const req: GenerateRequest = { system: "s", messages: [{ role: "user", text: "x" }] };

    expect((await p.generate(req).catch((e) => e)).kind).toBe("rate_limited");
    expect(gate.stats().cooldownSec).toBe(3);
    mode = "ok";
    let done = false;
    const next = p.generate(req).then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(false); // still cooling down
    await vi.advanceTimersByTimeAsync(1_500);
    expect((await next).text).toBe("hi");

    mode = "daily";
    expect((await p.generate(req).catch((e) => e)).quota.daily).toBe(true);
    const before = calls.length;
    const again = await p.generate(req).catch((e) => e);
    expect(again.quota.daily).toBe(true);
    expect(calls.length).toBe(before); // no extra request spent
    expect(gate.stats().dailyQuotaExhausted).toBe(true);
  });

  it("drops a queued caller whose request is aborted", async () => {
    const gate = new AIGate({ maxConcurrent: 1, maxQueue: 10, maxWaitMs: 5000, rpm: 0 });
    const hold = deferred();
    const first = gate.run(() => hold.promise);
    const ac = new AbortController();
    const queued = gate.run(async () => "x", ac.signal).catch((e) => e);
    await tick();
    ac.abort();
    expect((await queued).kind).toBe("timeout");
    expect(gate.stats().queued).toBe(0);
    hold.resolve();
    await first;
    expect(gate.stats().active).toBe(0);
  });

  it("maps a busy gate to HTTP 503 with Retry-After", async () => {
    const res = apiError(new AIProviderError("busy", "saturated", { retryAfterSec: 7 }));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("7");
    const body = await res.json();
    expect(body.error.code).toBe("ai_busy");
    expect(body.error.message).toMatch(/Try again in 7 seconds/);
  });
});
