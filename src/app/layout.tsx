import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/public-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXORA AI — invoicing co-pilot",
  description:
    "Describe the job in plain English. NEXORA drafts the invoice, waits for your approval, sends it through PayPal and tracks payment.",
};

export const viewport: Viewport = { themeColor: "#0f2a44" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
