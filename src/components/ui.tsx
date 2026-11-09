"use client";

import clsx from "clsx";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }
>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        "inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-control)] font-medium transition-[background,color,box-shadow,transform] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" && "h-8 px-3 text-sm",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-base",
        variant === "primary" && "bg-stamp text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-stamp-deep",
        variant === "secondary" && "border border-rule-strong bg-sheet text-ink hover:border-ink-3 hover:bg-paper",
        variant === "ghost" && "text-ink-2 hover:bg-ink/5 hover:text-ink",
        variant === "danger" && "border border-rose-ink/30 bg-sheet text-rose-ink hover:bg-rose/50",
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-paper text-ink-2 border-rule-strong" },
  sent: { label: "Sent", cls: "bg-stamp-tint text-stamp-deep border-stamp/25" },
  payment_pending: { label: "Payment pending", cls: "bg-stamp-tint text-stamp-deep border-stamp/25" },
  partially_paid: { label: "Part paid", cls: "bg-canary text-canary-ink border-canary-ink/20" },
  overdue: { label: "Overdue", cls: "bg-rose text-rose-ink border-rose-ink/20" },
  paid: { label: "Paid", cls: "bg-ledger-tint text-ledger border-ledger/25" },
  cancelled: { label: "Cancelled", cls: "bg-paper text-ink-3 border-rule line-through decoration-1" },
  refunded: { label: "Refunded", cls: "bg-paper text-ink-2 border-rule-strong" },
  pending_approval: { label: "Awaiting approval", cls: "bg-canary text-canary-ink border-canary-ink/20" },
  executing: { label: "Sending…", cls: "bg-stamp-tint text-stamp-deep border-stamp/25" },
  executed: { label: "Approved", cls: "bg-ledger-tint text-ledger border-ledger/25" },
  failed: { label: "Failed", cls: "bg-rose text-rose-ink border-rose-ink/20" },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-paper text-ink-2 border-rule" };
  return (
    <span className={clsx("inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap", s.cls, className)}>
      {s.label}
    </span>
  );
}

/** Data provenance label. Demo and mock rows can never look like PayPal results. */
export function SourceBadge({ source, paypalId }: { source: string; paypalId?: string | null }) {
  if (source === "demo")
    return (
      <span className="inline-flex h-6 items-center rounded-[4px] border border-dashed border-ink-3/60 px-2 text-xs font-medium text-ink-3" title="Seeded sample row. Not in PayPal.">
        Demo data
      </span>
    );
  if (source === "mock_paypal")
    return (
      <span className="inline-flex h-6 items-center rounded-[4px] border border-dashed border-canary-ink/40 bg-canary/50 px-2 text-xs font-medium text-canary-ink" title="Created against the local PayPal mock, not PayPal.">
        Mock PayPal
      </span>
    );
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-[4px] border border-stamp/25 bg-stamp-tint px-2 text-xs font-medium text-stamp-deep" title={paypalId ?? undefined}>
      <span className="size-1.5 rounded-full bg-stamp" aria-hidden />
      PayPal Sandbox
    </span>
  );
}

export function SandboxBadge({ mode = "sandbox" }: { mode?: string }) {
  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-full border border-canary-ink/25 bg-canary px-3 text-xs font-semibold text-canary-ink"
      role="status"
      aria-label={mode === "mock" ? "Mock PayPal mode. No real API calls." : "PayPal Sandbox. Test money only."}
    >
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full rounded-full bg-canary-ink/40 motion-safe:animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-canary-ink" />
      </span>
      {mode === "mock" ? "Mock PayPal · no real calls" : "Sandbox · test money only"}
    </span>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-3" role="status">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-dashed border-rule-strong bg-sheet/60 p-8">
      <h3 className="font-display text-xl font-semibold tracking-tight">{title}</h3>
      <p className="max-w-prose text-sm text-ink-2">{body}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ message, debugId, onRetry }: { message: string; debugId?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-[var(--radius-control)] border border-rose-ink/25 bg-rose/40 px-4 py-3 text-sm text-rose-ink">
      <p className="min-w-0 flex-1">
        {message}
        {debugId ? <span className="mt-1 block text-xs opacity-80">PayPal debug ID: {debugId}</span> : null}
      </p>
      {onRetry ? (
        <button onClick={onRetry} className="font-semibold underline underline-offset-2">
          Try again
        </button>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(
        "h-10 w-full rounded-[var(--radius-control)] border bg-sheet px-3 text-sm text-ink placeholder:text-ink-3 focus:border-stamp focus:outline-none focus:ring-2 focus:ring-stamp/20",
        invalid ? "border-rose-ink/60" : "border-rule-strong",
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-rose-ink">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink sm:text-[2.5rem] sm:leading-[1.05]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
