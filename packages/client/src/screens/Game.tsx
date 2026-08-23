/**
 * The game screen: board, hand, bottle, turn indicator, event feed, solve box,
 * interrupt prompt — plus the Cast view (§7), which is a real mode rather than
 * a zoom level: big board, no hand, nothing a player would need to lean in for.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { LetterCard } from '@phrasey/shared';
import { Board } from '../components/Board';
import { Bottle } from '../components/Bottle';
import { BlowoutOverlay } from '../components/BlowoutOverlay';
import { EventFeed } from '../components/EventFeed';
import { Hand } from '../components/Hand';
import { InterruptPrompt } from '../components/InterruptPrompt';
import { PlayerRail } from '../components/PlayerRail';
import { SolveBox } from '../components/SolveBox';
import { TurnRing } from '../components/TurnRing';
import { useKeyboardPlay } from '../hooks/useKeyboardPlay';
import { useReducedMotion } from '../lib/motion';
import { joinUrl } from '../lib/format';
import {
  selectIsHost,
  selectIsMyTurn,
  selectMe,
  selectPlayerName,
  useGameStore,
} from '../store/gameStore';
import { RoundEnd } from './RoundEnd';

export function Game() {
  const reduced = useReducedMotion();
  const room = useGameStore((s) => s.room);
  const board = useGameStore((s) => s.board);
  const hand = useGameStore((s) => s.hand);
  const peeks = useGameStore((s) => s.peeks);
  const reveal = useGameStore((s) => s.reveal);
  const feed = useGameStore((s) => s.feed);
  const pressure = useGameStore((s) => s.pressure);
  const pressureMax = useGameStore((s) => s.pressureMax);
  const blownOut = useGameStore((s) => s.blownOut);
  const turnPlayerId = useGameStore((s) => s.turnPlayerId);
  const phase = useGameStore((s) => s.round?.phase ?? 'turn');
  const turnEndsAt = useGameStore((s) => s.turnEndsAt);
  const interrupt = useGameStore((s) => s.interrupt);
  const roundResult = useGameStore((s) => s.roundResult);
  const matchResult = useGameStore((s) => s.matchResult);
  const lastError = useGameStore((s) => s.lastError);
  const solveOpen = useGameStore((s) => s.solveOpen);
  const castView = useGameStore((s) => s.castView);
  const playerId = useGameStore((s) => s.playerId);

  const me = useGameStore(selectMe);
  const myTurn = useGameStore(selectIsMyTurn);
  const awaitingSolve = myTurn && phase === 'awaiting-solve';
  const isHost = useGameStore(selectIsHost);

  const playLetterCard = useGameStore((s) => s.playLetterCard);
  const playActionCard = useGameStore((s) => s.playActionCard);
  const discard = useGameStore((s) => s.discard);
  const solve = useGameStore((s) => s.solve);
  const playInterrupt = useGameStore((s) => s.playInterrupt);
  const setSolveOpen = useGameStore((s) => s.setSolveOpen);
  const passTurn = useGameStore((s) => s.passTurn);
  const startGame = useGameStore((s) => s.startGame);
  const dismissError = useGameStore((s) => s.dismissError);

  const [toast, setToast] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => {
    if (!lastError) return;
    flash(lastError.message);
    dismissError();
  }, [lastError, flash, dismissError]);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const onKeyPlay = useCallback(
    (card: LetterCard) => {
      setHighlight(card.id);
      setTimeout(() => setHighlight(null), 500);
      void playLetterCard(card.id);
    },
    [playLetterCard],
  );

  useKeyboardPlay({
    enabled: myTurn && !solveOpen && !roundResult,
    hand,
    guessed: board?.guessedLetters ?? [],
    onPlay: onKeyPlay,
    onOpenSolve: () => {
      if (!roundResult && !me?.solveLocked) setSolveOpen(true);
      else if (me?.solveLocked) flash("You're locked out of solving this round.");
    },
    onCancel: () => {
      setSolveOpen(false);
      // During the optional-solve beat, backing out IS declining it.
      if (useGameStore.getState().round?.phase === 'awaiting-solve') void passTurn();
    },
    onBlocked: (r) =>
      flash(
        r.reason === 'already-guessed'
          ? `${r.letter} is already on the board.`
          : `You aren't holding a ${r.letter}.`,
      ),
  });

  if (!room || !board) {
    return (
      <main id="main" className="grid flex-1 place-items-center">
        <p className="font-mono text-sm tracking-[0.16em] uppercase opacity-55">Dealing…</p>
      </main>
    );
  }

  const turnName = selectPlayerName(useGameStore.getState(), turnPlayerId);
  const interruptSource = selectPlayerName(useGameStore.getState(), interrupt?.sourcePlayerId);

  // ---- Cast view (§7): designed for a shared screen on a call. ----
  if (castView) {
    return (
      <main id="main" className="mx-auto flex w-full max-w-[110rem] flex-1 flex-col gap-5 px-4 pb-6">
        <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="flex min-w-0 flex-col gap-4">
            <Board board={board} delays={reveal.delays} size="cast" className="flex-1" />
            <PlayerRail
              players={room.players}
              currentPlayerId={turnPlayerId}
              selfId={playerId}
              turnEndsAt={turnEndsAt}
              turnSeconds={room.settings.turnSeconds}
              compact
            />
          </div>
          <aside className="flex flex-col items-center justify-between gap-4">
            <Bottle pressure={pressure} max={pressureMax} erupting={blownOut} />
            <div className="text-center">
              <p className="font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-55">Join at</p>
              <p className="font-mono text-sm break-all opacity-80">{joinUrl(room.code)}</p>
              <p className="font-mono text-4xl font-extrabold tracking-[0.1em]">{room.code}</p>
            </div>
          </aside>
        </div>
        <BlowoutOverlay show={blownOut} byName={selectPlayerName(useGameStore.getState(), roundResult?.blownBy)} />
        {roundResult && (
          <RoundEnd
            result={roundResult}
            players={room.players}
            selfId={playerId}
            isHost={isHost}
            match={matchResult}
            onContinue={() => void startGame()}
          />
        )}
      </main>
    );
  }

  // ---- Normal play ----
  return (
    <main id="main" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-3 pb-4 sm:px-4">
      <div className="grid flex-1 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_12rem]">
        <aside className="order-3 flex min-h-0 flex-col gap-4 lg:order-1">
          <PlayerRail
            players={room.players}
            currentPlayerId={turnPlayerId}
            selfId={playerId}
            turnEndsAt={turnEndsAt}
            turnSeconds={room.settings.turnSeconds}
          />
          <EventFeed items={feed} className="max-h-64 lg:max-h-none lg:flex-1" />
        </aside>

        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2">
          <div className="flex flex-wrap items-center gap-3 rounded-card border-2 border-ink/10 bg-white/65 px-3 py-2">
            <TurnRing endsAt={turnEndsAt} totalSeconds={room.settings.turnSeconds} size={44} showOffState />
            <p className="font-display text-lg font-bold" aria-live="polite">
              {!myTurn
                ? `${turnName || 'Somebody'} is up`
                : awaitingSolve
                  ? 'Solve it, or pass'
                  : 'Your turn'}
            </p>
            <p className="hidden font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-55 xl:block">
              {awaitingSolve
                ? 'enter to solve · esc to pass'
                : 'type a letter you hold · enter to solve · esc to cancel'}
            </p>
            <button
              type="button"
              onClick={() => setSolveOpen(true)}
              disabled={!!me?.solveLocked}
              className="ml-auto rounded-full bg-grape px-4 py-2 text-sm font-bold text-chill shadow-pop disabled:opacity-40"
            >
              Solve
            </button>
            {/*
              The optional-solve beat (§3.3). Without an explicit way to decline
              it, every turn sits here until the turn clock runs out.
            */}
            {awaitingSolve && (
              <button
                type="button"
                onClick={() => void passTurn()}
                className="rounded-full border-2 border-ink/20 px-4 py-2 text-sm font-bold"
              >
                Pass
              </button>
            )}
          </div>

          <Board board={board} delays={reveal.delays} peeks={peeks} />

          <Hand
            hand={hand}
            guessed={board.guessedLetters}
            players={room.players}
            selfId={playerId}
            myTurn={myTurn && !roundResult}
            onPlayLetter={(id) => void playLetterCard(id)}
            onPlayAction={(id, letter, target) => void playActionCard(id, letter, target)}
            onDiscard={(ids) => void discard(ids)}
            highlightCardId={highlight}
          />
        </div>

        <aside className="order-2 flex flex-col items-center gap-3 lg:order-3 lg:sticky lg:top-4 lg:self-start">
          <Bottle pressure={pressure} max={pressureMax} erupting={blownOut} />
        </aside>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.p
            key={toast}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.01 : 0.18 }}
            role="status"
            className="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-chill shadow-slab"
          >
            {toast}
          </motion.p>
        )}
      </AnimatePresence>

      <SolveBox
        open={solveOpen}
        hiddenLetters={board.hiddenLetters}
        locked={!!me?.solveLocked}
        onSubmit={(guess) => void solve(guess)}
        onCancel={() => setSolveOpen(false)}
      />

      <AnimatePresence>
        {interrupt && (
          <InterruptPrompt
            key={interrupt.windowId}
            expiresAt={interrupt.expiresAt}
            playableCardIds={interrupt.playableCardIds}
            hand={hand}
            sourceName={interruptSource || 'Somebody'}
            onPlay={(cardId) => void playInterrupt(cardId)}
            onDismiss={() => void useGameStore.getState().declineInterrupt()}
          />
        )}
      </AnimatePresence>

      <BlowoutOverlay show={blownOut} byName={selectPlayerName(useGameStore.getState(), roundResult?.blownBy)} />

      {roundResult && (
        <RoundEnd
          result={roundResult}
          players={room.players}
          selfId={playerId}
          isHost={isHost}
          match={matchResult}
          onContinue={() => void startGame()}
        />
      )}
    </main>
  );
}
