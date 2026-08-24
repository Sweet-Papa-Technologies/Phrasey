/**
 * Lobby: who is here, what the host has set, and — the thing this screen really
 * exists for — the room code, huge, with a QR code alongside (§6.6).
 */
import { BALANCE, type BotTier, type MatchMode, type RoomPublic, type RoomSettings } from '@phrasey/shared';
import { PlayerRail } from '../components/PlayerRail';
import { RoomCode } from '../components/RoomCode';
import { useGameStore } from '../store/gameStore';

export interface LobbyProps {
  room: RoomPublic;
  selfId: string | null;
  isHost: boolean;
  onSettings: (patch: Partial<RoomSettings>) => void;
  onStart: () => void;
}

const TIERS: { value: BotTier; label: string; blurb: string }[] = [
  { value: 'chill', label: 'Chill', blurb: 'Guesses politely. Solves rarely.' },
  { value: 'sharp', label: 'Sharp', blurb: 'Reads the board. Takes its shot.' },
  { value: 'ruthless', label: 'Ruthless', blurb: 'Optimal, and it uses interrupts.' },
];

function Segmented<T extends string | number | null>({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-65">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={[
                'rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold',
                on ? 'border-ink bg-ink text-chill' : 'border-ink/15 hover:bg-ink/6',
                disabled ? 'cursor-not-allowed opacity-45' : '',
              ].join(' ')}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Lobby({ room, selfId, isHost, onSettings, onStart }: LobbyProps) {
  const roomKey = useGameStore((s) => s.roomKey);
  const s = room.settings;

  /**
   * Bots are not seated until the match actually starts, so gating on the
   * current player count alone makes single-player — 1 human + bots, the
   * default configuration in §3.1 — impossible to launch.
   */
  const enoughSeats = room.players.length + s.botCount >= BALANCE.setup.minPlayers;
  const humans = room.players.filter((p) => !p.isBot).length;
  const maxBots = Math.min(BALANCE.setup.maxBots, BALANCE.setup.maxPlayers - humans);

  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-7 px-4 pb-10">
      <section className="rounded-slab border-2 border-ink/10 bg-white/65 p-5 sm:p-7" aria-label="Invite">
        <RoomCode code={room.code} roomKey={roomKey} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
        <section aria-label="Players" className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-bold">
            In the room{' '}
            <span className="font-mono text-sm opacity-55">
              {room.players.length}/{BALANCE.setup.maxPlayers}
            </span>
          </h2>
          <PlayerRail
            players={room.players}
            currentPlayerId={null}
            selfId={selfId}
            turnEndsAt={null}
            turnSeconds={null}
          />
        </section>

        <section aria-label="Match settings" className="flex flex-col gap-5 rounded-slab border-2 border-ink/10 bg-white/65 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl font-bold">Settings</h2>
            {!isHost && <p className="font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-55">Host decides</p>}
          </div>

          <Segmented<MatchMode>
            label="Match ends by"
            value={s.matchMode}
            disabled={!isHost}
            onChange={(matchMode) => onSettings({ matchMode })}
            options={[
              { value: 'rounds', label: 'Round count' },
              { value: 'score', label: 'Target score' },
            ]}
          />

          {s.matchMode === 'rounds' ? (
            <Segmented<number>
              label="Rounds"
              value={s.rounds}
              disabled={!isHost}
              onChange={(rounds) => onSettings({ rounds })}
              options={[3, 5, 7, 10].map((v) => ({ value: v, label: String(v) }))}
            />
          ) : (
            <Segmented<number>
              label="First to"
              value={s.targetScore}
              disabled={!isHost}
              onChange={(targetScore) => onSettings({ targetScore })}
              options={[150, 300, 500, 800].map((v) => ({ value: v, label: String(v) }))}
            />
          )}

          <Segmented<number | null>
            label="Turn timer"
            value={s.turnSeconds}
            disabled={!isHost}
            onChange={(turnSeconds) => onSettings({ turnSeconds })}
            options={[
              { value: 10, label: '10s' },
              { value: 15, label: '15s' },
              { value: 25, label: '25s' },
              { value: null, label: 'Off' },
            ]}
          />

          <Segmented<number>
            label="Bots"
            value={s.botCount}
            disabled={!isHost}
            onChange={(botCount) => onSettings({ botCount })}
            options={Array.from({ length: maxBots + 1 }, (_, i) => ({ value: i, label: String(i) }))}
          />

          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-65">Bot tier</span>
            <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label="Bot tier">
              {TIERS.map((t) => {
                const on = s.botTier === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    disabled={!isHost}
                    aria-pressed={on}
                    onClick={() => onSettings({ botTier: t.value })}
                    className={[
                      'rounded-card border-2 p-2.5 text-left',
                      on ? 'border-grape bg-grape/12' : 'border-ink/12 hover:bg-ink/5',
                      !isHost ? 'cursor-not-allowed opacity-55' : '',
                    ].join(' ')}
                  >
                    <span className="block font-display text-sm font-bold">{t.label}</span>
                    <span className="block text-xs opacity-65">{t.blurb}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/*
            A switch rather than a checkbox: a 20px checkbox is under half the
            44px a thumb needs, and there is no way to grow one without it
            looking like a mistake. This is the same control, at a size you can
            actually hit, and it reads its state as a word as well as a colour.
          */}
          <button
            type="button"
            role="switch"
            aria-checked={s.interruptsEnabled}
            disabled={!isHost}
            onClick={() => onSettings({ interruptsEnabled: !s.interruptsEnabled })}
            className={[
              'flex w-full items-center gap-3 rounded-card border-2 p-2.5 text-left',
              s.interruptsEnabled ? 'border-fanta bg-fanta/10' : 'border-ink/12',
              !isHost ? 'cursor-not-allowed opacity-55' : 'hover:bg-ink/5',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                s.interruptsEnabled ? 'bg-fanta' : 'bg-ink/20'
              }`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-chill shadow transition-[left] ${
                  s.interruptsEnabled ? 'left-6' : 'left-1'
                }`}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                Interrupt cards{' '}
                <span className="font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-60">
                  {s.interruptsEnabled ? 'on' : 'off'}
                </span>
              </span>
              <span className="block text-xs opacity-65">
                Swipe, Block and Buzz In — playable out of turn inside a {BALANCE.interrupt.windowMs / 1000}s window.
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={!isHost || !enoughSeats}
            onClick={onStart}
            className="mt-1 rounded-full bg-fanta px-6 py-4 font-display text-xl font-extrabold text-ink shadow-pop disabled:opacity-45"
          >
            {isHost ? 'Start the match' : 'Waiting for the host'}
          </button>
          {!enoughSeats && (
            <p className="text-sm text-cherry">Needs at least {BALANCE.setup.minPlayers} players — add a bot.</p>
          )}
        </section>
      </div>
    </main>
  );
}
