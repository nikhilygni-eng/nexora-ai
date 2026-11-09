"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Activity, BarChart3, FileText, LogOut, Menu, MessageSquareText, Settings, X } from "lucide-react";
import { SandboxBadge } from "./ui";
import { Logo } from "./logo";

const NAV = [
  { href: "/app", label: "Command Center", icon: MessageSquareText },
  { href: "/app/invoices", label: "Invoices", icon: FileText },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/app/activity", label: "Activity log", icon: Activity },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export type ShellStatus = { paypalMode: string; paypalReady: boolean; aiReady: boolean; aiProvider: string; aiModel: string };

export function AppShell({ children, status }: { children: ReactNode; status: ShellStatus }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setOpen(false)}
          aria-current={active(href) ? "page" : undefined}
          className={clsx(
            "flex h-10 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium transition-colors",
            active(href) ? "bg-white text-ink" : "text-white/75 hover:bg-white/10 hover:text-white",
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );

  const health = (
    <div className="space-y-2 rounded-[var(--radius-control)] border border-white/15 p-3 text-xs text-white/80">
      <p className="flex items-center gap-2">
        <Dot ok={status.paypalReady} />
        PayPal {status.paypalMode === "mock" ? "mock" : "Sandbox"} {status.paypalReady ? "connected" : "not configured"}
      </p>
      <p className="flex items-center gap-2">
        <Dot ok={status.aiReady} />
        <span className="truncate">{status.aiReady ? `${providerName(status.aiProvider)} · ${status.aiModel}` : "AI not configured"}</span>
      </p>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr] lg:bg-[linear-gradient(to_right,var(--ink)_248px,transparent_248px)]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 bg-ink px-4 py-6 text-white lg:flex">
        <Link href="/app" className="px-2">
          <Logo inverted />
        </Link>
        {nav}
        <div className="mt-auto space-y-3">
          {health}
          <button onClick={signOut} className="flex h-9 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-white/70 hover:bg-white/10 hover:text-white">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-ink px-4 py-3 text-white lg:hidden">
        <Link href="/app">
          <Logo inverted />
        </Link>
        <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="rounded p-2 hover:bg-white/10">
          <Menu className="size-5" />
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-6 bg-ink p-4 text-white">
            <div className="flex items-center justify-between">
              <Logo inverted />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded p-2 hover:bg-white/10">
                <X className="size-5" />
              </button>
            </div>
            {nav}
            <div className="mt-auto space-y-3">
              {health}
              <button onClick={signOut} className="flex h-9 w-full items-center gap-3 rounded px-3 text-sm text-white/70 hover:bg-white/10">
                <LogOut className="size-4" aria-hidden /> Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-w-0">
        <div className="flex items-center justify-end gap-3 border-b border-rule bg-paper/80 px-4 py-2.5 backdrop-blur sm:px-8">
          <SandboxBadge mode={status.paypalMode} />
        </div>
        <main id="main" className="mx-auto w-full max-w-[1280px] px-4 py-8 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return <span className={clsx("size-2 shrink-0 rounded-full", ok ? "bg-[#6fd3a5]" : "bg-[#f2a7b3]")} aria-hidden />;
}

export function providerName(p: string) {
  return p === "freellmapi" ? "FreeLLMAPI" : p === "gemini" ? "Gemini" : "Scripted test provider";
}
