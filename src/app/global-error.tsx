"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary: replaces the root layout when the layout itself fails, so it can't rely on
 * app components or stylesheets. Plain inline styles, same colors as the design tokens.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[nexora] global error", error.digest ?? "", error.message);
  }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#f4f6f9", color: "#0f2a44", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <main role="alert" style={{ maxWidth: 420, margin: "0 16px", padding: 24, background: "#ffffff", borderRadius: 4, boxShadow: "0 18px 32px -18px rgb(15 42 68 / 0.28)" }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>NEXORA hit a problem</h1>
          <p style={{ color: "#344b66", fontSize: 14, lineHeight: 1.5 }}>Nothing was sent to PayPal. Try again, or reload the page in a moment.</p>
          <button
            onClick={reset}
            style={{ height: 40, padding: "0 16px", border: 0, borderRadius: 8, background: "#2442c9", color: "#ffffff", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
          {error.digest ? <p style={{ marginTop: 20, fontSize: 12, color: "#5b6f86" }}>Error reference: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
