"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/client";
import { Logo } from "@/components/logo";
import { Button, ErrorNote, Field, Input, SandboxBadge } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { passcode } });
      router.push(next && next.startsWith("/app") ? next : "/app");
      router.refresh();
    } catch (e2) {
      setError((e2 as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Workspace passcode" htmlFor="pc" hint="Set as APP_PASSCODE in .env.local.">
        <Input id="pc" type="password" autoComplete="current-password" autoFocus value={passcode} onChange={(e) => setPasscode(e.target.value)} required />
      </Field>
      {error ? <ErrorNote message={error} /> : null}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <SandboxBadge />
        </div>
        <div className="perforated rounded-t-[var(--radius-sheet)] bg-sheet p-6 shadow-[var(--shadow-sheet)]">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-ink-2">Single-user demo workspace.</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
