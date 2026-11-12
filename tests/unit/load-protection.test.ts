import { describe, expect, it } from "vitest";
import { Bulkhead, BusyError, singleFlight } from "@/lib/concurrency";
import { MAX_RATE_LIMIT_KEYS, rateLimit, rateLimitKeyCount } from "@/lib/ratelimit";
import { assertCapacity, setLagForTests } from "@/lib/load";
import { resetEnvCache } from "@/lib/env";
import { apiError } from "@/lib/api";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("Bulkhead", () => {
  it("runs at most N at once, queues the next ones, and rejects the overflow immediately", async () => {
    const b = new Bulkhead("test", 2, 1, 5_000);
    const gate = deferred();
    let running = 0;
    let peak = 0;
    const task = () =>
      b.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await gate.promise;
        running--;
        return "ok";
      });
    const a = task();
    const c = task();
    const queued = task();
    await expect(task()).rejects.toBeInstanceOf(BusyError); // 2 running + 1 queued = full
    expect(b.stats).toEqual({ active: 2, queued: 1 });
    gate.resolve();
    await expect(Promise.all([a, c, queued])).resolves.toEqual(["ok", "ok", "ok"]);
    expect(peak).toBe(2);
    expect(b.stats).toEqual({ active: 0, queued: 0 });
  });

  it("gives up on a queued task after maxWaitMs instead of hanging", async () => {
    const b = new Bulkhead("test", 1, 5, 20);
    const gate = deferred();
    const first = b.run(() => gate.promise);
    const err = await b.run(async () => "never").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusyError);
    expect((err as BusyError).retryAfterSec).toBeGreaterThanOrEqual(1);
    gate.resolve();
    await first;
    expect(b.stats).toEqual({ active: 0, queued: 0 });
  });

  it("releases the slot when the task throws", async () => {
    const b = new Bulkhead("test", 1, 0, 10);
    await expect(b.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(b.run(async () => "next")).resolves.toBe("next");
  });
});

describe("singleFlight", () => {
  it("shares one in-flight call between concurrent callers, then runs fresh", async () => {
    let calls = 0;
    const gate = deferred();
    const work = async () => {
      calls++;
      await gate.promise;
      return calls;
    };
    const results = Promise.all(Array.from({ length: 100 }, () => singleFlight("k", work)));
    gate.resolve();
    expect(await results).toEqual(Array(100).fill(1));
    expect(await singleFlight("k", async () => "fresh")).toBe("fresh");
  });

  it("does not keep a failed call around", async () => {
    await expect(singleFlight("bad", () => { throw new Error("sync throw"); })).rejects.toThrow("sync throw");
    await expect(singleFlight("bad", async () => "recovered")).resolves.toBe("recovered");
  });
});

describe("rate limiter memory", () => {
  it("caps the number of tracked keys under a flood of unique IPs", () => {
    for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 5_000; i++) rateLimit(`login:10.0.${i}`, 8, 60_000);
    expect(rateLimitKeyCount()).toBeLessThanOrEqual(MAX_RATE_LIMIT_KEYS);
  });

  it("keeps recently used keys when evicting, so active limits still hold", () => {
    for (let i = 0; i < 8; i++) rateLimit("agent:org", 8, 60_000);
    for (let i = 0; i < MAX_RATE_LIMIT_KEYS; i++) {
      rateLimit(`login:ip${i}`, 8, 60_000);
      if (i % 1000 === 0) rateLimit("agent:org", 8, 60_000); // still being hit
    }
    expect(rateLimit("agent:org", 8, 60_000).ok).toBe(false);
  });
});

describe("load shedding", () => {
  it("is off unless LOAD_SHED_LAG_MS is set", () => {
    setLagForTests(5_000, 5_000);
    expect(() => assertCapacity()).not.toThrow();
  });

  it("rejects work only when lag stays above the threshold for two windows", () => {
    process.env.LOAD_SHED_LAG_MS = "500";
    resetEnvCache();
    try {
      setLagForTests(100, 900); // a single spike
      expect(() => assertCapacity()).not.toThrow();
      setLagForTests(800, 900); // sustained
      expect(() => assertCapacity()).toThrow(BusyError);
      process.env.LOAD_SHED_LAG_MS = "0";
      resetEnvCache();
      expect(() => assertCapacity()).not.toThrow();
    } finally {
      delete process.env.LOAD_SHED_LAG_MS;
      resetEnvCache();
    }
  });

  it("maps BusyError to 503 with Retry-After", async () => {
    const res = apiError(new BusyError("full", 7));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(await res.json()).toMatchObject({ error: { code: "busy" } });
  });
});
