"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[nexora] page error", error.digest ?? "", error.message);
  }, [error]);
  return (
    <main>
      <ErrorScreen
        title="This page hit a problem"
        body="Nothing was sent to PayPal from this screen. Try again, and if it keeps happening, reload the page."
        digest={error.digest}
        onRetry={reset}
      />
    </main>
  );
}
