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
}

export function PlayerRail({
  players,
  currentPlayerId,
  selfId,
  turnEndsAt,
  turnSeconds,
  compact = false,
}: PlayerRailProps) {
  return (
    <ul
      className={`flex w-full gap-2 ${compact ? 'flex-wrap justify-center' : 'flex-col'}`}
      aria-label="Players"
    >
      {players.map((p) => {
        const active = p.id === currentPlayerId;
        return (
          <motion.li
            key={p.id}
            layout
            className={[
              'flex items-center gap-3 rounded-card border-2 px-3 py-2',
              active ? 'border-fanta bg-fanta/12' : 'border-ink/10 bg-white/55',
              compact ? 'min-w-40' : '',
            ].join(' ')}
            title={p.botPersona ?? undefined}
            aria-current={active ? 'true' : undefined}
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-display text-sm font-bold text-ink"
              style={{ background: p.color }}
              aria-hidden="true"
            >
              {p.name.slice(0, 1).toUpperCase()}
            </span>
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
            {active && <TurnRing endsAt={turnEndsAt} totalSeconds={turnSeconds} size={38} />}
          </motion.li>
        );
      })}
    </ul>
  );
}
