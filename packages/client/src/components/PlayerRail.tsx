/**
 * Who is playing, who is up, and what everybody has banked.
 * Bot personas surface on hover — cheap, big payoff for single-player feel (§5).
 */
import { motion } from 'motion/react';
import type { PlayerPublic } from '@phrasey/shared';
import { TurnRing } from './TurnRing';

export interface PlayerRailProps {
  players: PlayerPublic[];
  currentPlayerId: string | null;
  selfId: string | null;
  turnEndsAt: number | null;
  turnSeconds: number | null;
  compact?: boolean;
  /**
   * `column` is the §9 left rail. `strip` is the phone: a single row of the
   * same cards that scrolls sideways inside itself, so eight players cost one
   * line of vertical space instead of eight.
   */
  layout?: 'column' | 'strip';
}

export function PlayerRail({
  players,
  currentPlayerId,
  selfId,
  turnEndsAt,
  turnSeconds,
  compact = false,
  layout = 'column',
}: PlayerRailProps) {
  const strip = layout === 'strip' && !compact;
  return (
    <ul
      className={[
        'flex w-full min-w-0 gap-2',
        compact ? 'flex-wrap justify-center' : '',
        strip ? 'rail-scroll snap-x overflow-x-auto pb-1' : '',
        !compact && !strip ? 'flex-col' : '',
      ].join(' ')}
      aria-label="Players"
    >
      {players.map((p) => {
        const active = p.id === currentPlayerId;
        return (
          <motion.li
            key={p.id}
            layout
            className={[
              'flex items-center rounded-card border-2',
              active ? 'border-fanta bg-fanta/12' : 'border-ink/10 bg-white/55',
              compact ? 'min-w-40 gap-3 px-3 py-2' : '',
              strip ? 'shrink-0 snap-start gap-2 px-2 py-1.5' : '',
              !compact && !strip ? 'gap-3 px-3 py-2' : '',
            ].join(' ')}
            title={p.botPersona ?? undefined}
            aria-current={active ? 'true' : undefined}
          >
            <span
              className={`grid shrink-0 place-items-center rounded-full font-display font-bold text-ink ${
                strip ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm'
              }`}
              style={{ background: p.color }}
              aria-hidden="true"
            >
              {p.name.slice(0, 1).toUpperCase()}
            </span>

            {/*
              The strip is a phone-width pill: name, score, and nothing else.
              Widening it to carry the full card is what turns the rail into a
              row of half-cut cards — the thing this screen was reported for.
            */}
            {strip ? (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="max-w-[6.5rem] truncate text-xs font-semibold">{p.name}</span>
                <span className="font-mono text-[0.625rem] tabular-nums opacity-65">{p.score}</span>
                {p.roundScore !== 0 && (
                  <span
                    className={`font-mono text-[0.625rem] font-bold ${p.roundScore > 0 ? 'text-melon' : 'text-cherry'}`}
                  >
                    {p.roundScore > 0 ? '+' : ''}
                    {p.roundScore}
                  </span>
                )}
                <span className="sr-only">
                  {p.isBot ? 'bot. ' : ''}
                  {p.id === selfId ? 'you. ' : ''}
                  {p.handCount} cards in hand.{p.solveLocked ? ' Locked out of solving.' : ''}
                </span>
              </span>
            ) : (
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                  {p.name}
                  {p.id === selfId && <span className="sticker bg-grape text-chill">you</span>}
                  {p.isBot && <span className="sticker bg-ink/10 text-ink">bot</span>}
                  {p.connection === 'disconnected' && <span className="sticker bg-cherry text-chill">away</span>}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[0.625rem] tracking-[0.06em] whitespace-nowrap opacity-65">
                  <span>{p.score} pts</span>
                  {p.roundScore !== 0 && (
                    <span
                      className={p.roundScore > 0 ? 'font-bold text-melon' : 'font-bold text-cherry'}
                      title="Points banked this round"
                    >
                      {p.roundScore > 0 ? '+' : ''}
                      {p.roundScore}
                    </span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>
                    {p.handCount}
                    <span className="sr-only"> cards in hand</span>
                    <span aria-hidden="true">c</span>
                  </span>
                  {p.solveLocked && <span className="font-bold text-cherry">locked</span>}
                </span>
              </span>
            )}
            {active && <TurnRing endsAt={turnEndsAt} totalSeconds={turnSeconds} size={strip ? 26 : 38} />}
          </motion.li>
        );
      })}
    </ul>
  );
}
