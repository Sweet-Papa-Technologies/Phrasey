/** Wordmark. Bricolage Grotesque, used with restraint (§9). */
export function Logo({ className, subtitle = false }: { className?: string; subtitle?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 ${className ?? ''}`}>
      <span className="font-display text-2xl leading-none font-extrabold tracking-tight">
        Phrase<span className="text-fanta">y</span>
      </span>
      {subtitle && (
        <span className="font-mono text-[0.5625rem] tracking-[0.18em] uppercase opacity-55">party word game</span>
      )}
    </span>
  );
}
