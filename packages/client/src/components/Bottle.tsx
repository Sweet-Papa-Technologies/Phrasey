/**
 * THE BOTTLE (§9) — the signature element and the game's emotional centerpiece.
 *
 * A tall soda bottle that fills with fizzing liquid as shared pressure rises:
 * cherry→fanta gradient, bubbles ascending, condensation beading on the glass,
 * and a cap that rattles visibly harder the fuller it gets. At blowout it
 * erupts.
 *
 * Everything is driven by one 0–1 fraction derived from `pressure / max`.
 *
 * §10: pressure is never conveyed by color alone. Fill height, cap rattle,
 * numbered tick marks, a numeric readout, a state word and an aria-label all
 * encode the same number.
 */
import { useEffect, useMemo } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useReducedMotion } from '../lib/motion';

const W = 140;
const H = 400;
/** Inner cavity, in viewBox units. */
const LIQ_TOP = 74;
const LIQ_BOTTOM = 382;
const LIQ_H = LIQ_BOTTOM - LIQ_TOP;

export interface BottleProps {
  pressure: number;
  max: number;
  /** Blowout: the cap goes, and the bottle empties itself upward. */
  erupting?: boolean;
  /** Cast view and the landing hero use a slimmer chrome. */
  compact?: boolean;
  /**
   * How much room the bottle has.
   *
   * `rail` is the §9 arrangement: a tall bottle down the side of the board.
   * `perch` is the phone: there is no right rail on a 390px screen, so the
   * bottle stands beside the turn indicator above the board instead — still a
   * bottle, still the tallest thing on the screen after the board, and it
   * costs the board no width at all. It is not a slim horizontal gauge.
   */
  size?: 'rail' | 'perch';
  className?: string;
}

/** Non-color state words, so the gauge reads without seeing it (§10). */
export function pressureStateLabel(fraction: number): string {
  if (fraction >= 1) return 'BLOWN';
  if (fraction >= 0.83) return 'CRITICAL';
  if (fraction >= 0.58) return 'SHAKING';
  if (fraction >= 0.3) return 'FIZZING';
  if (fraction > 0) return 'SETTLING';
  return 'STILL';
}

/**
 * Sticker colors for the state word. Contrast is checked at every step: the
 * label has to stay readable, because under §10 it is one of the non-color
 * encodings of the gauge.
 */
export function stateStickerStyle(fraction: number): { background: string; color: string } {
  if (fraction >= 0.83) return { background: '#FF2E63', color: '#14121F' };
  if (fraction >= 0.58) return { background: '#FF5C1A', color: '#14121F' };
  if (fraction >= 0.3) return { background: '#FFC93C', color: '#14121F' };
  return { background: '#14121F', color: '#EAF4F7' };
}

/** Deterministic scatter, so decoration never re-randomises between renders. */
function scatter(n: number, seed: number): number[] {
  const out: number[] = [];
  let a = seed >>> 0;
  for (let i = 0; i < n; i++) {
    a = (a * 1664525 + 1013904223) >>> 0;
    out.push(a / 4294967296);
  }
  return out;
}

/**
 * How tall the glass is drawn. Every one of these is a viewport-relative
 * clamp, because the bottle's job is to stay legible from across the room on a
 * cast screen and from arm's length on a phone.
 */
const GLASS_HEIGHT: Record<'compact' | 'rail' | 'perch', string> = {
  compact: 'h-[clamp(11rem,30vh,18rem)] w-auto',
  rail: 'h-[clamp(10rem,34vh,26rem)] w-auto short-landscape:h-[clamp(8rem,56vh,12rem)] lg:h-[clamp(16rem,52vh,30rem)]',
  // Phone: as tall as the turn card next to it allows, and no taller.
  perch: 'h-[clamp(7.5rem,24vh,13rem)] w-auto',
};

export function Bottle({
  pressure,
  max,
  erupting = false,
  compact = false,
  size = 'rail',
  className,
}: BottleProps) {
  const reduced = useReducedMotion();
  const safeMax = max > 0 ? max : 1;
  const fraction = Math.min(1, Math.max(0, pressure / safeMax));

  // §9: "liquid glugs up in a single weighted motion, never a linear fill."
  // A spring with low damping gives the overshoot-and-settle of liquid finding
  // its level; reduced motion snaps instead.
  const raw = useMotionValue(fraction);
  const fill = useSpring(raw, reduced ? { duration: 0.001 } : { stiffness: 95, damping: 11, mass: 1.15 });
  useEffect(() => {
    if (reduced) raw.jump(fraction);
    else raw.set(fraction);
  }, [fraction, raw, reduced]);

  const liquidShift = useTransform(fill, (v) => (1 - v) * LIQ_H);
  const heat = useTransform(fill, [0, 0.55, 1], [0, 0.25, 0.85]);

  const bubbles = useMemo(() => {
    const r = scatter(48, 9127);
    return Array.from({ length: 16 }, (_, i) => ({
      cx: 32 + (r[i * 3] ?? 0.5) * 76,
      cy: 12 + (r[i * 3 + 1] ?? 0.5) * (LIQ_H - 20),
      rad: 1.2 + (r[i * 3 + 2] ?? 0.5) * 3,
      dur: 2.1 + (r[i * 3] ?? 0.5) * 2.6,
      delay: (r[i * 3 + 1] ?? 0.5) * 3.4,
      rise: 46 + (r[i * 3 + 2] ?? 0.5) * 96,
    }));
  }, []);

  const beads = useMemo(() => {
    const r = scatter(90, 5521);
    return Array.from({ length: 30 }, (_, i) => ({
      cx: 26 + (r[i * 3] ?? 0.5) * 88,
      cy: 108 + (r[i * 3 + 1] ?? 0.5) * 262,
      rx: 0.9 + (r[i * 3 + 2] ?? 0.5) * 2.4,
      o: 0.18 + (r[i * 3] ?? 0.5) * 0.42,
    }));
  }, []);

  const drips = useMemo(() => {
    const r = scatter(12, 3313);
    return Array.from({ length: 4 }, (_, i) => ({
      cx: 30 + (r[i * 3] ?? 0.5) * 80,
      cy: 150 + (r[i * 3 + 1] ?? 0.5) * 170,
      dur: 3.4 + (r[i * 3 + 2] ?? 0.5) * 3,
      delay: (r[i * 3] ?? 0.5) * 5,
    }));
  }, []);

  // Cap rattle: amplitude and tempo both scale with how full the bottle is.
  const rattleAmp = (0.25 + fraction * fraction * 3.4).toFixed(2);
  const rattleDur = Math.max(70, 460 - fraction * 380);
  const stateLabel = pressureStateLabel(fraction);
  const uid = compact ? 'c' : 'g';

  return (
    <div
      className={`flex shrink-0 flex-col items-center gap-1 sm:gap-2 ${className ?? ''}`}
      role="img"
      aria-label={`Pressure gauge: ${Math.round(pressure)} of ${safeMax}. ${stateLabel.toLowerCase()}.`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={GLASS_HEIGHT[compact ? 'compact' : size]}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${uid}-liquid`} x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0%" stopColor="#FF2E63" />
            <stop offset="46%" stopColor="#FF4438" />
            <stop offset="100%" stopColor="#FF5C1A" />
          </linearGradient>
          <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="22%" stopColor="#ffffff" stopOpacity="0.08" />
            <stop offset="72%" stopColor="#14121F" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#14121F" stopOpacity="0.22" />
          </linearGradient>
          <linearGradient id={`${uid}-cap`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF7A45" />
            <stop offset="55%" stopColor="#FF2E63" />
            <stop offset="100%" stopColor="#B41340" />
          </linearGradient>
          {/* The condensation PNG is a luminance map: black is dry glass, white
              is a droplet. Used as a mask rather than a blend mode so it
              composites identically in every engine. */}
          <mask id={`${uid}-cond`} maskUnits="userSpaceOnUse" x="16" y="80" width="108" height="304">
            <image
              href="/textures/condensation.png"
              x="16"
              y="80"
              width="108"
              height="304"
              preserveAspectRatio="none"
            />
          </mask>
          <clipPath id={`${uid}-cavity`}>
            <path d="M57 40 L57 63 C57 84 27 92 25 124 L25 355 C25 372 37 383 53 383 L87 383 C103 383 115 372 115 355 L115 124 C113 92 83 84 83 63 L83 40 Z" />
          </clipPath>
        </defs>

        {/* Bottle shadow on the rail */}
        <ellipse cx="70" cy="390" rx="46" ry="7" fill="#14121F" opacity="0.16" />

        {/* Glass body */}
        <path
          d="M52 34 L52 62 C52 82 22 90 20 122 L20 356 C20 376 34 388 52 388 L88 388 C106 388 120 376 120 356 L120 122 C118 90 88 82 88 62 L88 34 Z"
          fill="#ffffff"
          fillOpacity="0.5"
          stroke="#14121F"
          strokeOpacity="0.22"
          strokeWidth="2"
        />

        {/* Liquid + fizz, clipped to the inner cavity */}
        <g clipPath={`url(#${uid}-cavity)`}>
          <motion.g style={{ y: liquidShift }}>
            <rect x="0" y={LIQ_TOP} width={W} height={LIQ_H + 60} fill={`url(#${uid}-liquid)`} />
            <motion.rect
              x="0"
              y={LIQ_TOP}
              width={W}
              height={LIQ_H + 60}
              fill="#FF2E63"
              style={{ opacity: heat }}
            />

            {/* Surface: a meniscus and a head of foam sitting on it */}
            <path
              d={`M0 ${LIQ_TOP} Q 20 ${LIQ_TOP - 5} 38 ${LIQ_TOP} T 74 ${LIQ_TOP} T 110 ${LIQ_TOP} T ${W} ${LIQ_TOP} L ${W} ${LIQ_TOP + 8} L 0 ${LIQ_TOP + 8} Z`}
              fill="#FFC0A6"
              opacity="0.75"
            />
            <g data-motion="foam" opacity="0.9">
              {[26, 40, 55, 70, 85, 100, 113].map((x, i) => (
                <circle key={x} cx={x} cy={LIQ_TOP - 1} r={2.4 + (i % 3)} fill="#FFE3D6" opacity="0.85" />
              ))}
            </g>

            {/* Ascending bubbles */}
            <g data-motion="bubbles">
              {bubbles.map((b, i) => (
                <circle
                  key={i}
                  cx={b.cx}
                  cy={LIQ_TOP + b.cy}
                  r={b.rad}
                  fill="#FFFFFF"
                  opacity="0"
                  style={
                    {
                      animation: `phrasey-bubble ${b.dur}s linear ${b.delay}s infinite`,
                      ['--rise' as string]: b.rise,
                    } as React.CSSProperties
                  }
                />
              ))}
            </g>
          </motion.g>
        </g>

        {/* Numbered pressure ticks — the gauge readable without color (§10) */}
        <g clipPath={`url(#${uid}-cavity)`}>
          {Array.from({ length: safeMax }, (_, i) => {
            const y = LIQ_BOTTOM - ((i + 1) / safeMax) * LIQ_H;
            const major = (i + 1) % 3 === 0;
            return (
              <g key={i}>
                <rect
                  x={major ? 92 : 100}
                  y={y - 0.75}
                  width={major ? 20 : 12}
                  height="1.5"
                  fill="#14121F"
                  opacity={major ? 0.4 : 0.22}
                />
                {major && (
                  <text
                    x="88"
                    y={y + 3.2}
                    textAnchor="end"
                    fontSize="8"
                    fontFamily="var(--font-mono)"
                    fill="#14121F"
                    opacity="0.4"
                  >
                    {i + 1}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Condensation on the glass. The tiled map does the fine work; the
            hand-placed beads below give it a few larger, catchable droplets. */}
        <g clipPath={`url(#${uid}-cavity)`} pointerEvents="none">
          <rect
            x="16"
            y="80"
            width="108"
            height="304"
            fill="#ffffff"
            opacity="0.5"
            mask={`url(#${uid}-cond)`}
          />
          {beads.map((b, i) => (
            <ellipse key={i} cx={b.cx} cy={b.cy} rx={b.rx} ry={b.rx * 1.25} fill="#ffffff" opacity={b.o} />
          ))}
          <g data-motion="drip">
            {drips.map((d, i) => (
              <ellipse
                key={i}
                cx={d.cx}
                cy={d.cy}
                rx="1.6"
                ry="2.6"
                fill="#ffffff"
                opacity="0"
                style={{ animation: `phrasey-drip ${d.dur}s ease-in ${d.delay}s infinite` }}
              />
            ))}
          </g>
        </g>

        {/* Glass sheen over everything */}
        <path
          d="M52 34 L52 62 C52 82 22 90 20 122 L20 356 C20 376 34 388 52 388 L88 388 C106 388 120 376 120 356 L120 122 C118 90 88 82 88 62 L88 34 Z"
          fill={`url(#${uid}-glass)`}
          pointerEvents="none"
        />
        <rect x="29" y="132" width="7" height="196" rx="3.5" fill="#ffffff" opacity="0.4" />
        <rect x="41" y="150" width="3" height="120" rx="1.5" fill="#ffffff" opacity="0.25" />

        {/* Neck threads */}
        <g opacity="0.5">
          {[40, 47, 54].map((y) => (
            <rect key={y} x="51" y={y} width="38" height="3" rx="1.5" fill="#14121F" opacity="0.16" />
          ))}
        </g>

        {/* Cap — rattles harder the fuller it gets; leaves entirely at blowout */}
        <motion.g
          animate={erupting ? { y: -150, rotate: 38, opacity: 0 } : { y: 0, rotate: 0, opacity: 1 }}
          transition={
            erupting
              ? { duration: reduced ? 0.001 : 0.55, ease: [0.2, 0.9, 0.3, 1] }
              : { duration: reduced ? 0.001 : 0.3 }
          }
          style={{ transformOrigin: '70px 24px' }}
        >
          <g
            style={
              {
                animation: reduced || erupting ? 'none' : `phrasey-rattle ${rattleDur}ms linear infinite`,
                ['--rattle' as string]: rattleAmp,
                transformOrigin: '70px 24px',
              } as React.CSSProperties
            }
          >
            <rect x="46" y="8" width="48" height="26" rx="5" fill={`url(#${uid}-cap)`} />
            {[50, 56, 62, 68, 74, 80, 86].map((x) => (
              <rect key={x} x={x} y="11" width="2.4" height="20" rx="1.2" fill="#14121F" opacity="0.22" />
            ))}
            <rect x="46" y="8" width="48" height="7" rx="3.5" fill="#ffffff" opacity="0.3" />
          </g>
        </motion.g>

        {/* Eruption jet */}
        {erupting && !reduced && (
          <g>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <motion.circle
                key={i}
                cx={70 + (i - 2.5) * 9}
                cy={34}
                r={5 + (i % 3) * 3}
                fill={i % 2 ? '#FFE3D6' : '#FF5C1A'}
                initial={{ y: 0, opacity: 0.95, scale: 0.6 }}
                animate={{ y: -110 - i * 16, opacity: 0, scale: 1.9 }}
                transition={{ duration: 0.85, delay: i * 0.035, ease: 'easeOut' }}
              />
            ))}
          </g>
        )}
      </svg>

      {/* The same number, as text. Never color alone (§10). */}
      <div className="flex flex-col items-center gap-0.5 select-none">
        <div
          className={`font-mono leading-none font-bold tabular-nums ${
            size === 'perch' && !compact ? 'text-sm' : 'text-lg'
          }`}
        >
          {Math.round(pressure)}
          <span className="opacity-45">/{safeMax}</span>
        </div>
        <div className="sticker" style={stateStickerStyle(fraction)}>
          {stateLabel}
        </div>
      </div>
    </div>
  );
}
