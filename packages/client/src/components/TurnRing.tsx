/**
 * The turn timer (§9): "a thin ring, not a number, until the last 5 seconds."
 *
 * §10: the host can turn the timer off entirely, in which case there is no ring
 * and no time pressure at all — this component renders a calm "no timer" state
 * rather than pretending.
 */
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/motion';

const NUMBER_THRESHOLD_MS = 5000;

export interface TurnRingProps {
  /** Epoch ms the turn ends, or null when the host disabled the timer. */
  endsAt: number | null;
  totalSeconds: number | null;
  size?: number;
  color?: string;
  label?: string;
  /** Render a placeholder when the timer is off. Off by default. */
  showOffState?: boolean;
}

export function TurnRing({
  endsAt,
  totalSeconds,
  size = 56,
  color = '#FF5C1A',
  label,
  showOffState = false,
}: TurnRingProps) {
  const reduced = useReducedMotion();
  const [remaining, setRemaining] = useState(() => (endsAt ? Math.max(0, endsAt - Date.now()) : 0));
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(0);
      return;
    }
    let alive = true;
    const tick = () => {
      if (!alive) return;
      setRemaining(Math.max(0, endsAt - Date.now()));
      frame.current = requestAnimationFrame(tick);
    };
    // Reduced motion: sample once a second instead of every frame.
    if (reduced) {
      const id = setInterval(() => setRemaining(Math.max(0, endsAt - Date.now())), 1000);
      setRemaining(Math.max(0, endsAt - Date.now()));
      return () => clearInterval(id);
    }
    frame.current = requestAnimationFrame(tick);
    return () => {
      alive = false;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [endsAt, reduced]);

  const r = size / 2 - 3;
  const circumference = 2 * Math.PI * r;

  // The host can switch the timer off entirely (§10). There is then nothing to
  // count, so the ring gets out of the way rather than drawing a fake dial.
  if (endsAt === null || totalSeconds === null) {
    if (!showOffState) return null;
    return (
      <div
        className="flex items-center justify-center rounded-full border-2 border-dashed border-current opacity-40"
        style={{ width: size, height: size }}
        title="The host turned the turn timer off"
        aria-label="Turn timer is off"
        role="img"
      >
        <svg
          viewBox="0 0 24 24"
          width={size * 0.42}
          height={size * 0.42}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden="true"
        >
          <path d="M6 12h12" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  const fraction = Math.min(1, Math.max(0, remaining / (totalSeconds * 1000)));
  const urgent = remaining <= NUMBER_THRESHOLD_MS;
  const seconds = Math.ceil(remaining / 1000);

  return (
    <div
      className="relative"
      style={{ width: size, height: size }}
      role="timer"
      aria-label={label ?? `${seconds} seconds left in this turn`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={urgent ? '#FF2E63' : color}
          strokeWidth={urgent ? 4.5 : 3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          style={
            urgent && !reduced ? { animation: 'phrasey-pulse-ring 0.75s ease-in-out infinite' } : undefined
          }
        />
      </svg>
      {urgent && (
        <span className="absolute inset-0 flex items-center justify-center font-mono text-base font-extrabold tabular-nums text-cherry">
          {seconds}
        </span>
      )}
    </div>
  );
}
