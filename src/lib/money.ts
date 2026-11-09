/**
 * Money is stored as integer minor units (e.g. cents). Never floats.
 * PayPal expects amounts as decimal strings with the currency's exact number of decimals.
 */

/** Currencies accepted by PayPal REST APIs, with their decimal places. */
export const CURRENCIES = {
  AUD: 2, BRL: 2, CAD: 2, CNY: 2, CZK: 2, DKK: 2, EUR: 2, HKD: 2, HUF: 0, ILS: 2,
  INR: 2, JPY: 0, MYR: 2, MXN: 2, TWD: 0, NZD: 2, NOK: 2, PHP: 2, PLN: 2, GBP: 2,
  SGD: 2, SEK: 2, CHF: 2, THB: 2, USD: 2,
} as const satisfies Record<string, number>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function decimalsFor(currency: CurrencyCode): number {
  return CURRENCIES[currency];
}

const DECIMAL_RE = /^\d{1,12}(\.\d{1,6})?$/;

/**
 * Parse a user/AI amount ("800", "800.5", "1,250.00", 800) into minor units.
 * Rejects negatives, NaN, more precision than the currency allows.
 */
export function toMinor(amount: string | number, currency: CurrencyCode): number {
  const raw = typeof amount === "number" ? numberToPlainString(amount) : amount.trim().replace(/,/g, "");
  if (!DECIMAL_RE.test(raw)) throw new MoneyError(`"${amount}" is not a valid amount`);
  const [whole, frac = ""] = raw.split(".");
  const d = decimalsFor(currency);
  const trimmedFrac = frac.replace(/0+$/, "");
  if (trimmedFrac.length > d) {
    throw new MoneyError(`${currency} amounts allow at most ${d} decimal place${d === 1 ? "" : "s"}`);
  }
  const minor = Number(whole) * 10 ** d + Number((trimmedFrac + "0".repeat(d)).slice(0, d) || "0");
  if (!Number.isSafeInteger(minor)) throw new MoneyError("Amount is too large");
  return minor;
}

/** Minor units → PayPal decimal string ("800.00", or "1500" for JPY). */
export function fromMinor(minor: number, currency: CurrencyCode): string {
  if (!Number.isSafeInteger(minor)) throw new MoneyError("Minor units must be a safe integer");
  const d = decimalsFor(currency);
  const neg = minor < 0;
  const abs = Math.abs(minor);
  if (d === 0) return (neg ? "-" : "") + String(abs);
  const s = String(abs).padStart(d + 1, "0");
  return (neg ? "-" : "") + s.slice(0, -d) + "." + s.slice(-d);
}

export function formatMoney(minor: number, currency: string, locale = "en-US"): string {
  const cur = isCurrencyCode(currency) ? currency : "USD";
  const d = decimalsFor(cur);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: cur,
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(minor / 10 ** d);
}

/** Quantity as hundredths (2 decimals max), e.g. "1.5" → 150. */
export function quantityToHundredths(q: string | number): number {
  const raw = typeof q === "number" ? numberToPlainString(q) : q.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) throw new MoneyError(`"${q}" is not a valid quantity`);
  const [w, f = ""] = raw.split(".");
  const v = Number(w) * 100 + Number((f + "00").slice(0, 2));
  if (v <= 0) throw new MoneyError("Quantity must be greater than zero");
  return v;
}

/** Tax percent as thousandths of a percent (3 decimals max), e.g. "18" → 18000, "7.25" → 7250. */
export function percentToMilli(p: string | number): number {
  const raw = typeof p === "number" ? numberToPlainString(p) : p.trim().replace(/%$/, "");
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(raw)) throw new MoneyError(`"${p}" is not a valid percentage`);
  const [w, f = ""] = raw.split(".");
  const v = Number(w) * 1000 + Number((f + "000").slice(0, 3));
  if (v > 100000) throw new MoneyError("Tax cannot exceed 100%");
  return v;
}

export function milliToPercentString(milli: number): string {
  const w = Math.floor(milli / 1000);
  const f = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return f ? `${w}.${f}` : String(w);
}

/** Round half up for non-negative integer division. */
function divRoundHalfUp(n: number, d: number): number {
  return Math.floor((n * 2 + d) / (2 * d));
}

export type LineInput = { unitMinor: number; qtyHundredths: number; taxMilli: number };
export type LineTotals = { subtotalMinor: number; taxMinor: number; totalMinor: number };

export function lineTotals(l: LineInput): LineTotals {
  const subtotalMinor = divRoundHalfUp(l.unitMinor * l.qtyHundredths, 100);
  const taxMinor = divRoundHalfUp(subtotalMinor * l.taxMilli, 100000);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

export function invoiceTotals(lines: LineInput[]): LineTotals {
  return lines.map(lineTotals).reduce(
    (acc, t) => ({
      subtotalMinor: acc.subtotalMinor + t.subtotalMinor,
      taxMinor: acc.taxMinor + t.taxMinor,
      totalMinor: acc.totalMinor + t.totalMinor,
    }),
    { subtotalMinor: 0, taxMinor: 0, totalMinor: 0 },
  );
}

export class MoneyError extends Error {}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n) || n < 0) throw new MoneyError(`"${n}" is not a valid amount`);
  // Avoid exponent notation and float noise like 0.1+0.2 by limiting to 6 decimals.
  return n.toFixed(6).replace(/\.?0+$/, "");
}
