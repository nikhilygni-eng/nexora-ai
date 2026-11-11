import { ErrorScreen } from "@/components/error-screen";

export default function NotFound() {
  return (
    <main>
      <ErrorScreen title="Page not found" body="This page doesn't exist or has moved." homeHref="/app" homeLabel="Open NEXORA" />
    </main>
  );
}
