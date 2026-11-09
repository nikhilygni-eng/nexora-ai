/** Subset of the PayPal Invoicing v2 `invoice` resource that NEXORA reads. */
export type PayPalMoney = { currency_code: string; value: string };

export type PayPalLink = { href: string; rel: string; method?: string };

export type PayPalInvoiceStatus =
  | "DRAFT"
  | "SENT"
  | "SCHEDULED"
  | "PAID"
  | "MARKED_AS_PAID"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_PAID"
  | "PARTIALLY_REFUNDED"
  | "MARKED_AS_REFUNDED"
  | "UNPAID"
  | "PAYMENT_PENDING"
  | "AUTO_CANCELLED"
  | "PAID_EXTERNAL"
  | "REFUNDED_EXTERNAL"
  | "SHARED";

export type PayPalInvoice = {
  id: string;
  status: PayPalInvoiceStatus;
  detail: {
    invoice_number?: string;
    currency_code: string;
    invoice_date?: string;
    payment_term?: { due_date?: string; term_type?: string };
    metadata?: {
      create_time?: string;
      recipient_view_url?: string;
      invoicer_view_url?: string;
      first_sent_time?: string;
      last_sent_time?: string;
    };
  };
  amount?: { currency_code: string; value: string };
  due_amount?: PayPalMoney;
  payments?: { paid_amount?: PayPalMoney; transactions?: { payment_date?: string }[] };
  links?: PayPalLink[];
};
