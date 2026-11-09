import clsx from "clsx";

/** Wordmark: a folded invoice corner as the "N" mark. */
export function Logo({ inverted, className }: { inverted?: boolean; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden className="shrink-0">
        <path d="M2 2h15l7 7v19H2z" fill={inverted ? "#ffffff" : "#0f2a44"} />
        <path d="M17 2v7h7" fill={inverted ? "#b9c4d2" : "#5b6f86"} />
        <path d="M7 22V11l7 11V11" fill="none" stroke={inverted ? "#2442c9" : "#ffffff"} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <span className={clsx("font-display text-[1.15rem] font-bold tracking-[-0.03em]", inverted ? "text-white" : "text-ink")}>
        nexora<span className={inverted ? "text-white/55" : "text-ink-3"}> ai</span>
      </span>
    </span>
  );
}
