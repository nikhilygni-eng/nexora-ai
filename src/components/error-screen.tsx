"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui";

/**
 * Shared fallback for error boundaries and 404s. Never shows stack traces or server details,
 * only the error digest (which matches the server log line) so a crash can be traced.
 */
export function ErrorScreen({
  title,
  body,
  digest,
  onRetry,
  homeHref = "/",
  homeLabel = "Go to the start page",
  showLogo = true,
}: {
  title: string;
  body: string;
  digest?: string;
  onRetry?: () => void;
  homeHref?: string;
  homeLabel?: string;
  showLogo?: boolean;
}) {
  return (
    <div className="grid min-h-[60dvh] place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        {showLogo ? (
          <div className="mb-8">
            <Link href="/">
              <Logo />
            </Link>
          </div>
        ) : null}
        <div role="alert" className="perforated rounded-t-[var(--radius-sheet)] bg-sheet p-6 shadow-[var(--shadow-sheet)]">
          <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-ink-2">{body}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {onRetry ? (
              <Button variant="primary" onClick={onRetry} icon={<RotateCcw className="size-4" aria-hidden />}>
                Try again
              </Button>
            ) : null}
            <Link
              href={homeHref}
              className="inline-flex h-10 items-center rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-4 text-sm font-medium text-ink hover:border-ink-3 hover:bg-paper"
            >
              {homeLabel}
            </Link>
          </div>
          {digest ? <p className="mt-5 text-xs text-ink-3">Error reference: {digest}</p> : null}
        </div>
      </div>
    </div>
  );
}
