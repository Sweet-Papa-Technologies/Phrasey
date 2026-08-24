/**
 * Round end and match end: the answer revealed, per-player round scores, and
 * running totals.
 */
import { motion } from 'motion/react';
import type { MatchResult, PlayerPublic, RoundResult } from '@phrasey/shared';
import { useReducedMotion } from '../lib/motion';
import { signed } from '../lib/format';

const REASON_COPY: Record<RoundResult['reason'], { title: string; tone: string }> = {
  solved: { title: 'Solved', tone: 'bg-lime text-ink' },
  blowout: { title: 'Blowout', tone: 'bg-cherry text-chill' },
  'deck-exhausted': { title: 'Deck ran dry', tone: 'bg-soda text-ink' },
  abandoned: { title: 'Round abandoned', tone: 'bg-ink/15 text-ink' },
};

export interface RoundEndProps {
  result: RoundResult;
  players: PlayerPublic[];
  selfId: string | null;
  isHost: boolean;
  match: MatchResult | null;
  onContinue: () => void;
}

export function RoundEnd({ result, players, selfId, isHost, match, onContinue }: RoundEndProps) {
  const reduced = useReducedMotion();
  const reason = REASON_COPY[result.reason];
  const ranked = [...players].sort((a, b) => (result.totals[b.id] ?? 0) - (result.totals[a.id] ?? 0));
  const matchOver = !!match;
  // The round's biggest earner gets a price-sticker burst behind the number.
  const bestRound = Math.max(0, ...Object.values(result.roundScores));

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0.15 : 0.34, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-ink/55 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={matchOver ? 'Match over' : `Round ${result.roundNumber} over`}
    >
      {/*
        Centring and scrolling in one box cannot both work: a flex container
        that centres content taller than itself pushes the top out of reach,
        which on a landscape phone hid the "Next round" button entirely. The
        scroll lives on the backdrop; the centring lives on a `min-h-full`
        track inside it, so the panel centres when it fits and scrolls from the
        top when it does not.
      */}
      <div className="flex min-h-full items-center justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        <div className="w-full max-w-2xl rounded-slab border-2 border-ink/12 bg-chill p-4 shadow-slab sm:p-7">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className={`sticker ${reason.tone}`}>{reason.title}</span>
            <span className="font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-55">
              Round {result.roundNumber} · {result.category}
            </span>
          </div>

          <p className="font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-55">The answer was</p>
          <p className="mb-1 font-display text-[clamp(1.5rem,5.5vw,2.75rem)] leading-tight font-extrabold">
            {result.answer}
          </p>
          <p className="mb-5 text-sm opacity-65">{result.hint}</p>

          <table className="w-full text-left">
            <caption className="sr-only">Scores for round {result.roundNumber}</caption>
            <thead>
              <tr className="font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-55">
                <th scope="col" className="py-1">
                  Player
                </th>
                <th scope="col" className="py-1 pl-2 text-right">
                  <span className="sm:hidden">Round</span>
                  <span className="hidden sm:inline">This round</span>
                </th>
                <th scope="col" className="py-1 pl-2 text-right">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p) => {
                const round = result.roundScores[p.id] ?? 0;
                const total = result.totals[p.id] ?? 0;
                const won = match?.winnerIds.includes(p.id) ?? false;
                // The price-burst sticker sits *behind* the number, so the number
                // has to switch to ink — emitting `text-melon` as well left the
                // cascade to decide, and green-on-orange is the one combination
                // in this palette you genuinely cannot read.
                const topEarner = round > 0 && round === bestRound;
                const roundTone = topEarner
                  ? 'text-ink'
                  : round > 0
                    ? 'text-melon'
                    : round < 0
                      ? 'text-cherry'
                      : 'opacity-50';
                return (
                  <tr key={p.id} className="border-t border-ink/10">
                    <th scope="row" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2 font-semibold">
                      <span className="h-3 w-3 rounded-full" style={{ background: p.color }} aria-hidden="true" />
                      {p.name}
                      {p.id === selfId && <span className="sticker bg-grape text-chill">you</span>}
                      {p.id === result.solvedBy && <span className="sticker bg-lime text-ink">solved</span>}
                      {p.id === result.blownBy && <span className="sticker bg-cherry text-chill">popped it</span>}
                      {won && <span className="sticker bg-soda text-ink">winner</span>}
                    </th>
                    <td className="py-2 pl-2 text-right font-mono tabular-nums">
                      <span
                        className={`inline-flex h-9 min-w-12 items-center justify-center px-1 font-bold ${roundTone}`}
                        style={
                          topEarner
                            ? {
                                backgroundImage: "url('/textures/price-burst.png')",
                                backgroundSize: '3.25rem 3.25rem',
                                backgroundPosition: 'center',
                                backgroundRepeat: 'no-repeat',
                              }
                            : undefined
                        }
                      >
                        {signed(round)}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono font-bold tabular-nums">{total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm opacity-60">
              {matchOver
                ? `${match.roundsPlayed} rounds played.`
                : isHost
                  ? 'Next round starts on its own — or push it along.'
                  : 'Next round starts on its own.'}
            </p>
            <button
              type="button"
              onClick={onContinue}
              className="rounded-full bg-fanta px-6 py-3 font-display text-lg font-bold text-ink shadow-pop"
            >
              {matchOver ? 'Play again' : 'Next round'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
