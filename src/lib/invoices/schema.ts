import { z } from "zod";
import {
  CURRENCY_CODES,
  type CurrencyCode,
  fromMinor,
  invoiceTotals,
  isCurrencyCode,
  lineTotals,
  MoneyError,
  percentToMilli,
  quantityToHundredths,
  toMinor,
} from "@/lib/money";

/** Pragmatic RFC 5322-ish email check; PayPal validates again server-side. */
const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((v) => EMAIL_RE.test(v), "Not a valid email address");

const amountLike = z.union([z.string(), z.number()]);

/** What the AI (or the Edit form) submits for an invoice. Loose input, strict normalization. */
export const InvoiceDraftInputSchema = z.object({
  client_name: z.string().trim().min(1, "Client name is required").max(120),
  client_email: z.string().trim().max(254).optional().nullable(),
  client_company: z.string().trim().max(120).optional().nullable(),
  currency: z.string().trim().toUpperCase().optional().nullable(),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Item name is required").max(200),
        description: z.string().trim().max(1000).optional().nullable(),
        quantity: amountLike.optional().nullable(),
        unit_amount: amountLike,
      }),
    )
    .min(1, "At least one line item is required")
    .max(50),
  tax_percent: amountLike.optional().nullable(),
  tax_name: z.string().trim().max(40).optional().nullable(),
  due_date: z.string().trim().optional().nullable(),
  due_in_days: z.coerce.number().int().optional().nullable(),
  note: z.string().trim().max(4000).optional().nullable(),
});
export type InvoiceDraftInput = z.infer<typeof InvoiceDraftInputSchema>;

export const NormalizedItemSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  quantity: z.string(), // "1", "1.5"
  qty_hundredths: z.number().int().positive(),
  unit_minor: z.number().int().positive(),
  tax_milli: z.number().int().min(0).max(100000),
  subtotal_minor: z.number().int(),
  tax_minor: z.number().int(),
});
export type NormalizedItem = z.infer<typeof NormalizedItemSchema>;

export const NormalizedInvoiceSchema = z.object({
  client_name: z.string(),
  client_email: emailSchema,
  client_company: z.string().optional(),
  currency: z.enum(CURRENCY_CODES as [CurrencyCode, ...CurrencyCode[]]),
  tax_name: z.string(),
  tax_milli: z.number().int().min(0).max(100000),
  items: z.array(NormalizedItemSchema).min(1),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().optional(),
  subtotal_minor: z.number().int(),
  tax_minor: z.number().int(),
  total_minor: z.number().int().positive(),
});
export type NormalizedInvoice = z.infer<typeof NormalizedInvoiceSchema>;

export type Defaults = {
  currency: CurrencyCode;
  taxName: string;
  taxMilli: number;
  termsDays: number;
  today: string; // YYYY-MM-DD
};

export type ValidationResult =
  | { ok: true; invoice: NormalizedInvoice }
  | { ok: false; missing: string[]; errors: string[] };

export const MAX_DUE_DAYS = 365;

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Validate + normalize a draft. Returns missing fields (to ask the user about) separately
 * from hard errors (to correct). Never invents values: a missing email stays missing.
 */
export function normalizeInvoiceDraft(input: unknown, defaults: Defaults): ValidationResult {
  const parsed = InvoiceDraftInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      missing: [],
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "invoice"}: ${i.message}`),
    };
  }
  const d = parsed.data;
  const missing: string[] = [];
  const errors: string[] = [];

  let email: string | undefined;
  if (!d.client_email) missing.push("client_email");
  else {
    const e = emailSchema.safeParse(d.client_email);
    if (e.success) email = e.data;
    else errors.push(`client_email: "${d.client_email}" is not a valid email address`);
  }

  const currencyRaw = d.currency || defaults.currency;
  let currency: CurrencyCode = defaults.currency;
  if (!isCurrencyCode(currencyRaw)) errors.push(`currency: ${currencyRaw} is not supported by PayPal invoicing`);
  else currency = currencyRaw;

  let taxMilli = defaults.taxMilli;
  if (d.tax_percent !== undefined && d.tax_percent !== null && d.tax_percent !== "") {
    try {
      taxMilli = percentToMilli(d.tax_percent);
    } catch (e) {
      errors.push(`tax_percent: ${(e as Error).message}`);
    }
  }
  const taxName = d.tax_name || defaults.taxName || "Tax";

  let dueDate: string | undefined;
  if (d.due_date) {
    if (!isRealDate(d.due_date)) errors.push(`due_date: "${d.due_date}" must be a real date in YYYY-MM-DD format`);
    else dueDate = d.due_date;
  } else if (d.due_in_days !== undefined && d.due_in_days !== null) {
    dueDate = addDays(defaults.today, d.due_in_days);
  } else {
    dueDate = addDays(defaults.today, defaults.termsDays);
  }
  if (dueDate) {
    const delta = daysBetween(defaults.today, dueDate);
    if (delta < 0) errors.push(`due_date: ${dueDate} is in the past`);
    if (delta > MAX_DUE_DAYS) errors.push(`due_date: ${dueDate} is more than ${MAX_DUE_DAYS} days away`);
  }

  const items: NormalizedItem[] = [];
  d.items.forEach((it, idx) => {
    try {
      const qtyH = quantityToHundredths(it.quantity ?? "1");
      const unitMinor = toMinor(it.unit_amount, currency);
      if (unitMinor <= 0) throw new MoneyError("Unit amount must be greater than zero");
      const t = lineTotals({ unitMinor, qtyHundredths: qtyH, taxMilli });
      items.push({
        name: it.name,
        description: it.description || undefined,
        quantity: (qtyH % 100 === 0 ? String(qtyH / 100) : (qtyH / 100).toFixed(2).replace(/0$/, "")),
        qty_hundredths: qtyH,
        unit_minor: unitMinor,
        tax_milli: taxMilli,
        subtotal_minor: t.subtotalMinor,
        tax_minor: t.taxMinor,
      });
    } catch (e) {
      errors.push(`items[${idx}]: ${(e as Error).message}`);
    }
  });

  if (missing.length || errors.length || !email || !dueDate) return { ok: false, missing, errors };

  const totals = invoiceTotals(
    items.map((i) => ({ unitMinor: i.unit_minor, qtyHundredths: i.qty_hundredths, taxMilli: i.tax_milli })),
  );
  const invoice: NormalizedInvoice = {
    client_name: d.client_name,
    client_email: email,
    client_company: d.client_company || undefined,
    currency,
    tax_name: taxName,
    tax_milli: taxMilli,
    items,
    issue_date: defaults.today,
    due_date: dueDate,
    note: d.note || undefined,
    subtotal_minor: totals.subtotalMinor,
    tax_minor: totals.taxMinor,
    total_minor: totals.totalMinor,
  };
  const check = NormalizedInvoiceSchema.safeParse(invoice);
  if (!check.success) return { ok: false, missing: [], errors: check.error.issues.map((i) => i.message) };
  return { ok: true, invoice: check.data };
}

/** Back to the editable shape (for the Edit form). */
export function toDraftInput(inv: NormalizedInvoice): InvoiceDraftInput {
  return {
    client_name: inv.client_name,
    client_email: inv.client_email,
    client_company: inv.client_company ?? null,
    currency: inv.currency,
    items: inv.items.map((i) => ({
      name: i.name,
      description: i.description ?? null,
      quantity: i.quantity,
      unit_amount: fromMinor(i.unit_minor, inv.currency),
    })),
    tax_percent: String(inv.tax_milli / 1000),
    tax_name: inv.tax_name,
    due_date: inv.due_date,
    note: inv.note ?? null,
  };
}

export const ReminderPayloadSchema = z.object({
  invoice_id: z.string().min(1),
  paypal_invoice_id: z.string().min(1),
  subject: z.string().trim().min(3).max(200),
  note: z.string().trim().min(10).max(4000),
});
export type ReminderPayload = z.infer<typeof ReminderPayloadSchema>;

export const LOCAL_STATUSES = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
  "refunded",
  "payment_pending",
] as const;
export type LocalStatus = (typeof LOCAL_STATUSES)[number];
