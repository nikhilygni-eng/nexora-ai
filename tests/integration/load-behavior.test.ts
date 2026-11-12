import { describe, expect, it, vi } from "vitest";
import { runAgent } from "@/lib/ai/agent";
import { ScriptedProvider } from "@/lib/ai/scripted";
import { cachedJsonBody } from "@/lib/cache";
import { DEFAULT_ORG_ID, getDb, openDatabase, setDbForTests } from "@/lib/db";
import { upsertClient } from "@/lib/db/repo";
import { approveProposal, syncOpenInvoices } from "@/lib/invoices/service";
import { setPayPalFetcherForTests } from "@/lib/paypal";
import { mockPayPalFetcher } from "@/lib/paypal/mock";

const ORG = DEFAULT_ORG_ID;

describe("PayPal sync under a polling burst", () => {
  it("100 concurrent syncs make one round of PayPal calls, and every caller gets the result", async () => {
    const r = await runAgent({ orgId: ORG, message: "Bill Acme Corp $800 for the redesign. ap@acme.com", provider: new ScriptedProvider() });
    await approveProposal(ORG, r.proposalIds[0]);

    const spy = vi.fn(mockPayPalFetcher);
    setPayPalFetcherForTests(spy);
    const gets = () => spy.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === "GET" && String(u).includes("/v2/invoicing/invoices/")).length;

    const all = await Promise.all(Array.from({ length: 100 }, () => syncOpenInvoices(ORG, 0)));
    expect(gets()).toBe(1);
    expect(new Set(all.map((x) => JSON.stringify(x))).size).toBe(1);
    expect(all[0]).toHaveLength(1);

    await syncOpenInvoices(ORG, 0); // a later poll is a fresh round
    expect(gets()).toBe(2);
  });
});

describe("dashboard read cache", () => {
  it("serves repeat reads from cache and recomputes right after any write", () => {
    let computed = 0;
    const read = () => cachedJsonBody("t:clients", () => ({ n: ++computed }));
    expect(read()).toBe('{"n":1}');
    expect(read()).toBe('{"n":1}');
    expect(computed).toBe(1);

    upsertClient(ORG, { name: "Northwind", email: "billing@northwind.example" }); // any write
    expect(read()).toBe('{"n":2}');
    expect(read()).toBe('{"n":2}');
  });

  it("expires after the TTL even without writes", async () => {
    let computed = 0;
    const read = () => cachedJsonBody("t:ttl", () => ({ n: ++computed }), 5);
    read();
    await new Promise((r) => setTimeout(r, 10));
    read();
    expect(computed).toBe(2);
  });

  it("never serves an entry computed against a different database connection", () => {
    let computed = 0;
    const read = () => cachedJsonBody("t:db", () => ({ n: ++computed }));
    read();
    const versionOf = () => (getDb().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
    const v1 = versionOf();
    setDbForTests(openDatabase(":memory:")); // fresh connection: its write counter starts over
    expect(versionOf()).toBe(v1); // same counter value, so only the connection identity tells them apart
    expect(read()).toBe('{"n":2}');
  });
});
