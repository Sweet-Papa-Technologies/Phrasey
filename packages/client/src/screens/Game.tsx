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
import { JoinQr } from '../components/JoinQr';
import { PlayerRail } from '../components/PlayerRail';
import { SolveBox } from '../components/SolveBox';
import { TurnRing } from '../components/TurnRing';
import { useKeyboardPlay } from '../hooks/useKeyboardPlay';
import { useReducedMotion } from '../lib/motion';
import { useMediaQuery } from '../lib/viewport';
import { SOLVE_LOCK_COPY, solveLockReason } from '../lib/solveLock';
import { joinUrl } from '../lib/format';
import { selectIsHost, selectIsMyTurn, selectMe, selectPlayerName, useGameStore } from '../store/gameStore';
import { RoundEnd } from './RoundEnd';

export function Game() {
  const reduced = useReducedMotion();
  // These two mirror the breakpoints in `game-layout` (styles/index.css). They
  // exist because a couple of components need to change their *content*, not
  // just their box, when the arrangement changes.
  // Matches the desktop branch of `game-layout` exactly — a wide-but-short
  // window is not a desktop, and the feed has no rail to live on there.
  const wideRails = useMediaQuery('(min-width: 1024px) and (min-height: 561px)');
  const bottleRail = useMediaQuery('(min-width: 768px), (orientation: landscape) and (max-height: 560px)');
  // There is no "type a letter" on a touch screen, and the hint costs a row.
  const hasKeyboard = useMediaQuery('(pointer: fine)');
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
  const roomKey = useGameStore((s) => s.roomKey);

  const me = useGameStore(selectMe);
  const myTurn = useGameStore(selectIsMyTurn);
  const awaitingSolve = myTurn && phase === 'awaiting-solve';
  /*
   * Solving is legal at any point during your turn — it is no longer gated on
   * having played a card first. So the control is offered for the whole turn
   * and is simply *absent* the rest of the time: the reported confusion was a
   * greyed-out Solve sitting there saying "not your turn", and an absent
   * button asks no questions. `solveLocked` is the one case that still shows a
   * disabled control, because vanishing would leave the player wondering where
   * their Solve went rather than telling them they burnt it.
   */
  const canOfferSolve = myTurn && !roundResult;
  /*
   * There are two ways to lose the solve and the screen used to know about
   * only one of them. `solveLocked` is the wrong-solve lockout (§3.3);
   * `lockedNextTurn` is the LOCKOUT card (§3.5). The engine rejects a solve for
   * either, so a live Solve button under a LOCKOUT meant typing a whole guess
   * for nothing. `lib/solveLock.ts` decides which applies and owns the copy —
   * "for this round" and "this turn" are very different pieces of news.
   */
  const lockReason = solveLockReason(me);
  const solveLocked = lockReason !== null;
  const lockCopy = lockReason ? SOLVE_LOCK_COPY[lockReason] : null;
  const isHost = useGameStore(selectIsHost);

  const playLetterCard = useGameStore((s) => s.playLetterCard);
  const playActionCard = useGameStore((s) => s.playActionCard);
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

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

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
      if (!canOfferSolve) return;
      setSolveOpen(true);
    },
    solveBlocked: lockReason,
    onSolveBlocked: (reason) => flash(SOLVE_LOCK_COPY[reason].toast),
    onCancel: () => {
      setSolveOpen(false);
      // During the optional-solve beat, backing out IS declining it.
      if (useGameStore.getState().round?.phase === 'awaiting-solve') void passTurn();
    },
    onBlocked: (r) =>
      flash(
        r.reason === 'already-guessed' ? `${r.letter} is already on the board.` : `You aren't holding a ${r.letter}.`,
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
    /*
     * This is the screen an iPad casts to a TV, and the QR on it is what a
     * phone on the other side of the room is pointed at. It gets the whole
     * width of the rail and as much height as the bottle can spare — a code
     * that cannot be scanned from the sofa is not a join path, it is decor.
     */
    const castUrl = joinUrl(room.code, roomKey);
    return (
      <main id="main" className="mx-auto flex w-full max-w-[110rem] min-h-0 flex-1 flex-col gap-4 px-4 pb-4">
        {/*
          One column on a portrait tablet, two on anything wide. The board row
          is the `1fr`, so the bottle and the join block become a bounded band
          underneath rather than a column tall enough to squeeze the board into
          a strip — a cast screen with no board on it is not a cast screen.
        */}
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)]">
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <Board board={board} delays={reveal.delays} size="cast" className="min-h-0 flex-1" />
            <PlayerRail
              players={room.players}
              currentPlayerId={turnPlayerId}
              selfId={playerId}
              turnEndsAt={turnEndsAt}
              turnSeconds={room.settings.turnSeconds}
              compact
            />
          </div>
          <aside className="flex min-h-0 flex-row items-center justify-center gap-6 lg:flex-col lg:justify-between lg:gap-4">
            <Bottle pressure={pressure} max={pressureMax} erupting={blownOut} size="cast" />
            <div className="flex min-w-0 flex-col items-center gap-2 text-center lg:w-full">
              <JoinQr
                url={castUrl}
                displayPx={352}
                className="h-[clamp(9rem,26vh,22rem)] w-[clamp(9rem,26vh,22rem)] lg:h-[min(100%,clamp(11rem,34vh,22rem))] lg:w-[min(100%,clamp(11rem,34vh,22rem))]"
              />
              <p className="font-mono text-[0.6875rem] tracking-[0.16em] uppercase opacity-55">Scan, or join at</p>
              <p className="font-mono text-5xl leading-none font-extrabold tracking-[0.1em]">{room.code}</p>
              <p className="w-full truncate font-mono text-xs opacity-70">{castUrl}</p>
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
  /*
   * The arrangement is `game-layout` in styles/index.css — grid areas, because
   * the phone, the landscape phone, the tablet and the desktop each want a
   * genuinely different placement of the same pieces, and ordering flex
   * children by breakpoint cannot express that without lying to a screen
   * reader about the order things are in. Every row of it is content-sized
   * except the board, which takes the remainder of a viewport-height shell —
   * so nothing here can ever push Solve or the hand under the fold.
   */
  /*
   * Solve and Pass, rendered into the hand's control row rather than up here
   * in the status bar. Two things about them are deliberate:
   *
   *  - Solve is offered for the whole of your turn, not only after you have
   *    played. It is absent — not disabled — when it is not your turn.
   *  - Pass appears the instant a card lands, on the same row, already on
   *    screen. That row is the last thing above the cards, so the hand you
   *    just played from and the decision that follows it are the same reach.
   */
  const turnControls = (
    <>
      {canOfferSolve && (
        <button
          type="button"
          onClick={() => setSolveOpen(true)}
          disabled={solveLocked}
          aria-label={lockCopy ? lockCopy.detail : 'Solve the puzzle'}
          title={lockCopy ? lockCopy.detail : undefined}
          className="rounded-full bg-grape px-5 py-2 text-sm font-bold text-chill shadow-pop disabled:opacity-40 disabled:shadow-none"
        >
          {lockCopy ? lockCopy.button : 'Solve'}
        </button>
      )}
      {/*
        The optional-solve beat (§3.3). Without an explicit way to decline it,
        every turn sits here until the turn clock runs out.
      */}
      {awaitingSolve && (
        <button
          type="button"
          onClick={() => void passTurn()}
          className="rounded-full border-2 border-ink/25 px-5 py-2 text-sm font-bold"
        >
          Pass
        </button>
      )}
    </>
  );

  return (
    <main id="main" className="mx-auto min-h-0 w-full max-w-7xl flex-1 px-3 pb-1 sm:px-4">
      <div className="game-layout">
        <div className="game-status flex min-w-0 items-center gap-2.5 rounded-card border-2 border-ink/10 bg-white/65 px-2.5 py-1.5 short-landscape:py-1">
          <TurnRing endsAt={turnEndsAt} totalSeconds={room.settings.turnSeconds} size={44} showOffState />
          <p className="min-w-0 flex-1 truncate font-display text-base leading-tight font-bold sm:text-lg" aria-live="polite">
            {!myTurn ? `${turnName || 'Somebody'} is up` : awaitingSolve ? 'Solve it, or pass' : 'Your turn'}
          </p>
          {/* Keyboard play is a desktop affordance (§10). On a touch screen the
              hint is a line of copy describing keys nobody has. */}
          {hasKeyboard && (
            <p className="hidden shrink-0 font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-55 xl:block">
              {/* Don't advertise a key that is going to be refused. */}
              {solveLocked
                ? 'type a letter you hold · solving is locked'
                : awaitingSolve
                  ? 'enter to solve · esc to pass'
                  : 'type a letter you hold · enter to solve · esc to cancel'}
            </p>
          )}
        </div>

        {/*
          §9 puts the bottle on the right rail. A phone has no right rail, so
          below `md` it stands beside the turn card above the board: still a
          bottle, still the second-tallest thing on the screen, and it takes
          none of the board's width.
        */}
        <aside className="game-bottle flex min-h-0 items-start justify-center">
          <Bottle pressure={pressure} max={pressureMax} erupting={blownOut} size={bottleRail ? 'rail' : 'perch'} />
        </aside>

        <div className="game-players">
          <PlayerRail
            players={room.players}
            currentPlayerId={turnPlayerId}
            selfId={playerId}
            turnEndsAt={turnEndsAt}
            turnSeconds={room.settings.turnSeconds}
            layout={wideRails ? 'column' : 'strip'}
          />
        </div>

        <Board board={board} delays={reveal.delays} peeks={peeks} className="game-board" />

        {/*
          The feed has a rail of its own on a desktop and no row at all below
          it: on a phone it rides in the hand's control row as a chip and opens
          over the board. That is one fewer band of chrome between the board
          and the cards, and it is what the reserved control row is holding
          space for on somebody else's turn.
        */}
        {wideRails && <EventFeed items={feed} className="game-feed lg:flex-1" />}

        <div className="game-hand">
          <Hand
            hand={hand}
            guessed={board.guessedLetters}
            players={room.players}
            selfId={playerId}
            myTurn={myTurn && !roundResult}
            onPlayLetter={(id) => void playLetterCard(id)}
            onPlayAction={(id, letter, target) => void playActionCard(id, letter, target)}
            highlightCardId={highlight}
            controls={
              <>
                {turnControls}
                {!wideRails && <EventFeed items={feed} collapsible className="shrink-0" />}
              </>
            }
          />
        </div>
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
            className="pointer-events-none fixed inset-x-3 bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))] z-[45] mx-auto w-fit max-w-[calc(100vw-1.5rem)] rounded-full bg-ink px-4 py-2 text-center text-sm font-semibold text-chill shadow-slab"
          >
            {toast}
          </motion.p>
        )}
      </AnimatePresence>

      <SolveBox
        open={solveOpen}
        board={board}
        hiddenLetters={board.hiddenLetters}
        lockReason={lockReason}
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
