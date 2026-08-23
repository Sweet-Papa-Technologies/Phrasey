/**
 * BLOWOUT (§9): "it erupts, foam sheets across the board for a beat, and the
 * round ends."
 *
 * Reduced motion gets the same information as a cross-fade with no foam and no
 * shake — the word, the number, the end of the round.
 */
import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { useReducedMotion } from '../lib/motion';

function blobs(count: number): { x: number; y: number; r: number; d: number; delay: number }[] {
  let a = 987654321;
  const rnd = () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: rnd() * 100,
    y: rnd() * 30 - 10,
    r: 6 + rnd() * 22,
    d: 0.7 + rnd() * 0.8,
    delay: rnd() * 0.35,
  }));
}

export function BlowoutOverlay({ show, byName }: { show: boolean; byName?: string }) {
  const reduced = useReducedMotion();
  const foam = useMemo(() => blobs(46), []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.22 }}
          className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center overflow-hidden"
          role="status"
          aria-live="assertive"
        >
          <div className="absolute inset-0 bg-cherry/35 backdrop-blur-[2px]" />

          {/* The sheet: foam actually crossing the board, not just droplets. */}
          {!reduced && (
            <motion.div
              data-motion="foam"
              className="absolute inset-x-0 h-[70vh] bg-gradient-to-b from-white via-white/95 to-transparent"
              initial={{ y: '-100vh' }}
              animate={{ y: '110vh' }}
              transition={{ duration: 1.25, ease: [0.3, 0.7, 0.4, 1] }}
            />
          )}

          {!reduced && (
            <div data-motion="foam" className="absolute inset-0">
              {foam.map((b, i) => (
                <motion.span
                  key={i}
                  className="absolute rounded-full bg-white"
                  style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.r}vmin`, height: `${b.r}vmin` }}
                  initial={{ scale: 0, opacity: 0.95, y: 0 }}
                  animate={{ scale: [0, 1.5, 1.9], opacity: [0.95, 0.85, 0], y: ['0vh', '55vh', '110vh'] }}
                  transition={{ duration: b.d + 0.9, delay: b.delay, ease: [0.2, 0.8, 0.3, 1] }}
                />
              ))}
            </div>
          )}

          <motion.div
            initial={reduced ? { opacity: 0 } : { scale: 0.6, rotate: -6, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { scale: 1, rotate: -3, opacity: 1 }}
            transition={{ duration: reduced ? 0.15 : 0.45, ease: [0.2, 1.4, 0.4, 1] }}
            className="relative text-center"
          >
            <p className="font-display text-[clamp(3rem,16vw,11rem)] leading-none font-extrabold tracking-tighter text-ink drop-shadow-[0_6px_0_rgba(255,255,255,0.85)]">
              BLOWOUT
            </p>
            {byName && (
              <p className="mt-2 font-mono text-sm tracking-[0.18em] text-ink uppercase">
                {byName} shook it one time too many
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
