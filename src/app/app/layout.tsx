import { AppShell } from "@/components/shell";
import { getSetupStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const s = getSetupStatus();
  return (
    <AppShell status={{ paypalMode: s.paypalMode, paypalReady: s.paypalReady, aiReady: s.aiReady, aiProvider: s.aiProvider, aiModel: s.aiModel }}>
      {children}
    </AppShell>
  );
}
