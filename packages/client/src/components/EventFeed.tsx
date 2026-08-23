/** The running log of what just happened. Newest first, capped by the store. */
import { AnimatePresence, motion } from 'motion/react';
import type { FeedItem } from '../store/feed';
import { useReducedMotion } from '../lib/motion';

const TONE: Record<FeedItem['tone'], string> = {
  neutral: 'border-ink/10 bg-white/60',
  good: 'border-melon/45 bg-melon/12',
  bad: 'border-cherry/40 bg-cherry/10',
  big: 'border-grape/45 bg-grape/12 font-display font-bold',
};

export function EventFeed({ items, className }: { items: FeedItem[]; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <section className={`flex min-h-0 flex-col ${className ?? ''}`} aria-label="Event feed">
      <h2 className="mb-2 font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-55">Feed</h2>
      <ol className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((it) => (
            <motion.li
              key={it.id}
              initial={reduced ? { opacity: 0 } : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.01 : 0.2 }}
              className={`rounded-lg border px-2.5 py-1.5 text-[0.8125rem] leading-snug ${TONE[it.tone]}`}
            >
              {it.text}
            </motion.li>
          ))}
        </AnimatePresence>
        {items.length === 0 && <li className="text-sm opacity-45">Nothing yet.</li>}
      </ol>
    </section>
  );
}
