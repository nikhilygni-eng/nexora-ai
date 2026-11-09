import { describe, expect, it } from "vitest";
import {
  formatMoney,
  fromMinor,
  invoiceTotals,
  isCurrencyCode,
  lineTotals,
  milliToPercentString,
  MoneyError,
  percentToMilli,
  quantityToHundredths,
  toMinor,
} from "@/lib/money";

describe("money", () => {
  it("parses decimal strings to minor units without float error", () => {
    expect(toMinor("800", "USD")).toBe(80000);
    expect(toMinor("0.1", "USD")).toBe(10);
    expect(toMinor("1,250.50", "USD")).toBe(125050);
    expect(toMinor(19.99, "EUR")).toBe(1999);
    expect(toMinor("0.30", "USD")).toBe(30);
  });

  it("respects zero-decimal currencies", () => {
    expect(toMinor("1500", "JPY")).toBe(1500);
    expect(() => toMinor("1500.5", "JPY")).toThrow(MoneyError);
    expect(fromMinor(1500, "JPY")).toBe("1500");
  });

  it("rejects invalid amounts", () => {
    for (const bad of ["-5", "abc", "", "1.234", "1e5"]) expect(() => toMinor(bad, "USD")).toThrow(MoneyError);
    expect(() => toMinor(-1, "USD")).toThrow(MoneyError);
    expect(() => toMinor(Number.NaN, "USD")).toThrow(MoneyError);
  });

  it("formats minor units as PayPal decimal strings", () => {
    expect(fromMinor(80000, "USD")).toBe("800.00");
    expect(fromMinor(5, "USD")).toBe("0.05");
    expect(fromMinor(0, "GBP")).toBe("0.00");
    expect(() => fromMinor(1.5, "USD")).toThrow();
  });

  it("computes line and invoice totals with half-up rounding", () => {
    // 3 × 33.33 = 99.99; 18% tax = 17.9982 → 18.00
    expect(lineTotals({ unitMinor: 3333, qtyHundredths: 300, taxMilli: 18000 })).toEqual({ subtotalMinor: 9999, taxMinor: 1800, totalMinor: 11799 });
    // 1.5 × 10.01 = 15.015 → 15.02
    expect(lineTotals({ unitMinor: 1001, qtyHundredths: 150, taxMilli: 0 }).subtotalMinor).toBe(1502);
    expect(
      invoiceTotals([
        { unitMinor: 80000, qtyHundredths: 100, taxMilli: 0 },
        { unitMinor: 5000, qtyHundredths: 200, taxMilli: 7250 },
      ]),
    ).toEqual({ subtotalMinor: 90000, taxMinor: 725, totalMinor: 90725 });
  });

  it("validates quantities and tax percent", () => {
    expect(quantityToHundredths("1.5")).toBe(150);
    expect(() => quantityToHundredths("0")).toThrow();
    expect(percentToMilli("7.25")).toBe(7250);
    expect(percentToMilli("18%")).toBe(18000);
    expect(() => percentToMilli("101")).toThrow();
    expect(milliToPercentString(7250)).toBe("7.25");
    expect(milliToPercentString(18000)).toBe("18");
  });

  it("validates currency codes", () => {
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("XYZ")).toBe(false);
    expect(isCurrencyCode("toString")).toBe(false);
    expect(formatMoney(80000, "USD")).toBe("$800.00");
  });
});
