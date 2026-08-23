/**
 * The landing page hero (§9): "The hero *is* the game: a live demo board
 * already mid-puzzle, tiles revealing on a loop, the bottle filling."
 *
 * It runs a real `MockGame` behind a real `Transport`, so what you see on the
 * marketing page is the actual game loop, not a video of one. It keeps its own
 * state rather than using the store, so it can never collide with a real room.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card, MaskedBoard, PlayerPublic } from '@phrasey/shared';
import { createMockTransport } from '../net/mockTransport';
import { cascadeDelayMap, collectRevealPositions, planRevealCascade } from '../lib/reveal';
import { useReducedMotion } from '../lib/motion';
import { Board } from './Board';
import { Bottle } from './Bottle';
import { PlayingCard } from './PlayingCard';

export function DemoBoard({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [board, setBoard] = useState<MaskedBoard | null>(null);
  const [pressure, setPressure] = useState(0);
  const [pressureMax, setPressureMax] = useState(12);
  const [delays, setDelays] = useState<Map<number, number>>(new Map());
  const [hand, setHand] = useState<Card[]>([]);
  const [players, setPlayers] = useState<PlayerPublic[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [erupting, setErupting] = useState(false);
  const eruptTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    const transport = createMockTransport({ demo: true, seed: 20260823 });
    const offs = [
      transport.on('board:update', ({ board: b, round, events }) => {
        setBoard(b);
        setPressure(round.pressure);
        setPressureMax(round.pressureMax);
        setCurrent(round.currentPlayerId);
        const positions = collectRevealPositions(events);
        if (positions.length > 0) {
          setDelays(cascadeDelayMap(planRevealCascade(positions, { reducedMotion: reducedRef.current })));
        }
        if (events.some((e) => e.t === 'blowout')) {
          setErupting(true);
          if (eruptTimer.current) clearTimeout(eruptTimer.current);
          eruptTimer.current = setTimeout(() => setErupting(false), 2600);
        }
        if (events.some((e) => e.t === 'round:start')) setErupting(false);
      }),
      transport.on('game:started', ({ board: b, round }) => {
        setBoard(b);
        setPressure(round.pressure);
        setPressureMax(round.pressureMax);
        setDelays(new Map());
      }),
      transport.on('hand:update', ({ cards }) => setHand(cards)),
      transport.on('room:state', (room) => setPlayers(room.players)),
      transport.on('pressure:update', ({ value, max }) => {
        setPressure(value);
        setPressureMax(max);
      }),
    ];
    void transport.connect();
    return () => {
      for (const off of offs) off();
      if (eruptTimer.current) clearTimeout(eruptTimer.current);
      transport.disconnect();
    };
  }, []);

  const fan = useMemo(() => hand.slice(0, 5), [hand]);

  return (
    <div className={`grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch ${className ?? ''}`}>
      <div className="flex min-w-0 flex-col gap-3">
        <ul className="flex flex-wrap items-center justify-center gap-2" aria-hidden="true">
          {players.map((p) => (
            <li
              key={p.id}
              className={[
                'flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs font-semibold',
                p.id === current ? 'border-fanta bg-fanta/15' : 'border-ink/10 bg-white/50',
              ].join(' ')}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
              {p.name}
              <span className="font-mono opacity-55">{p.score}</span>
            </li>
          ))}
        </ul>

        {board ? (
          <Board board={board} delays={delays} size="demo" />
        ) : (
          <div className="slab grid min-h-64 place-items-center text-chill/50">
            <span className="font-mono text-xs tracking-[0.16em] uppercase">Dealing…</span>
          </div>
        )}

        {/* A decorative fan of the demo player's hand — not interactive. */}
        <div className="hidden h-24 items-start justify-center gap-1 sm:flex" aria-hidden="true">
          {fan.map((card, i) => (
            <div key={card.id} className="origin-top scale-[0.62]">
              <PlayingCard
                card={card}
                inert
                reducedMotion
                rotate={(i - (fan.length - 1) / 2) * 6}
                lift={Math.abs(i - (fan.length - 1) / 2) ** 2 * 7}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center lg:w-48">
        <Bottle pressure={pressure} max={pressureMax} erupting={erupting} compact />
      </div>
    </div>
  );
}
