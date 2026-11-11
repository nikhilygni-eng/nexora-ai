import { describe, expect, it } from "vitest";
import { TtlCache } from "@/lib/cache";
import { rateLimit } from "@/lib/ratelimit";

describe("TtlCache", () => {
  it("shares one in-flight computation and serves it until the TTL ends", async () => {
    let t = 0;
    const c = new TtlCache<number>(10, () => t);
    let calls = 0;
    const slow = () => new Promise<number>((r) => setTimeout(() => r(++calls), 10));
    const [a, b] = await Promise.all([c.getOrCreate("k", 1000, slow), c.getOrCreate("k", 1000, slow)]);
    expect(calls).toBe(1);
    expect([a.cached, b.cached]).toEqual([false, true]);
    expect((await c.getOrCreate("k", 1000, slow)).cached).toBe(true);
    t = 1001;
    expect(c.has("k")).toBe(false);
    expect((await c.getOrCreate("k", 1000, slow)).value).toBe(2);
  });

  it("never caches failures and evicts the oldest entry when full", async () => {
    const c = new TtlCache<number>(2);
    await expect(c.getOrCreate("e", 1000, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(c.has("e")).toBe(false);
    await c.getOrCreate("a", 1000, async () => 1);
    await c.getOrCreate("b", 1000, async () => 2);
    await c.getOrCreate("c", 1000, async () => 3);
    expect([c.has("a"), c.has("b"), c.has("c")]).toEqual([false, true, true]);
  });
});

describe("rateLimit under many keys", () => {
  it("keeps enforcing active limits after sweeping idle keys", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("org", 3, 60_000).ok).toBe(true);
    for (let i = 0; i < 6000; i++) rateLimit(`login:10.0.${i >> 8}.${i & 255}`, 8, 60_000);
    expect(rateLimit("org", 3, 60_000).ok).toBe(false);
  });
});
