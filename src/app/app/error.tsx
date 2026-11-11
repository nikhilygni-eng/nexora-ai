"use client";

import { useEffect } from "react";
import { ErrorScreen } from "@/components/error-screen";

/** Inside the app shell: the sidebar stays usable, only the broken screen is replaced. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[nexora] app screen error", error.digest ?? "", error.message);
  }, [error]);
  return (
    <ErrorScreen
      showLogo={false}
      title="This screen hit a problem"
      body="Your invoices and approvals are safe: nothing reaches PayPal without your click. Try again, or open another section from the sidebar."
      digest={error.digest}
      onRetry={reset}
      homeHref="/app"
      homeLabel="Back to Command Center"
    />
  );
}
