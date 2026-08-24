import type { RoomPublic } from '@phrasey/shared';
import { Link } from '../lib/router';
import type { ConnectionState } from '../net/transport';
import { Logo } from './Logo';
import { MuteControl } from './MuteControl';
import { SameRoomToggle } from './SameRoomToggle';

export interface TopBarProps {
  room: RoomPublic | null;
  connection: ConnectionState;
  transportKind: 'mock' | 'socket';
  castView: boolean;
  onCastView?: (v: boolean) => void;
  muted: boolean;
  volume: number;
  onMuted: (v: boolean) => void;
  onVolume: (v: number) => void;
  /** Music bus level. Omit to hide the music slider. */
  musicVolume?: number;
  onMusicVolume?: (v: number) => void;
  /**
   * Same-room switch (§9). Omit `onSameRoom` on screens with no room — there
   * is nobody to share a room with yet.
   */
  sameRoom?: boolean;
  sameRoomIsHost?: boolean;
  sameRoomFromRoomDefault?: boolean;
  onSameRoom?: (v: boolean) => void;
  /**
   * Mid-round. The bar is overhead on a screen with a fixed height budget, so
   * everything that is a developer affordance or a nicety goes away and what
   * is left is one short row.
   */
  dense?: boolean;
}

/**
 * States worth a chip. "Live" and "Offline" are the two that tell a player
 * nothing they did not already know from the game responding to them, and a
 * green badge saying everything is fine is the definition of chrome. So the
 * bar is silent while the connection is healthy and speaks up when it is not.
 */
const NOTEWORTHY = new Set<ConnectionState>(['connecting', 'reconnecting', 'closed', 'error']);

const CONNECTION_COPY: Record<ConnectionState, { text: string; tone: string }> = {
  idle: { text: 'Offline', tone: 'bg-ink/12 text-ink' },
  connecting: { text: 'Connecting', tone: 'bg-soda text-ink' },
  connected: { text: 'Live', tone: 'bg-lime text-ink' },
  reconnecting: { text: 'Reconnecting', tone: 'bg-soda text-ink' },
  closed: { text: 'Disconnected', tone: 'bg-ink/12 text-ink' },
  error: { text: 'Connection error', tone: 'bg-cherry text-chill' },
};

export function TopBar({
  room,
  connection,
  transportKind,
  castView,
  onCastView,
  muted,
  volume,
  onMuted,
  onVolume,
  musicVolume,
  onMusicVolume,
  sameRoom,
  sameRoomIsHost,
  sameRoomFromRoomDefault,
  onSameRoom,
  dense = false,
}: TopBarProps) {
  const conn = CONNECTION_COPY[connection];
  /*
   * A status chip only when the connection is doing something you would want
   * to know about. Previously this bar carried a permanent "LIVE" badge and,
   * on the mock, a permanent "DEMO SERVER" badge beside it — two stickers that
   * never change, on the screen where every row costs the board a row of tiles.
   */
  const showConn = NOTEWORTHY.has(connection);
  return (
    /*
     * The top bar is overhead, and on a phone it was costing four wrapped rows
     * — a quarter of the screen — before the game even started. Everything
     * optional now collapses: the two volume sliders hide behind the mute
     * button (which still works), and the labels shorten. `dense` (mid-round)
     * goes one further and drops the developer affordances entirely.
     */
    <header
      className={[
        'flex w-full shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 sm:gap-3 sm:px-4 short-landscape:py-0.5',
        dense ? 'py-1' : 'py-2 sm:py-3',
      ].join(' ')}
    >
      <Link to="/" aria-label="Phrasey home" className="tap">
        <Logo />
      </Link>

      {room && (
        <span className="font-mono text-sm font-bold tracking-[0.18em] opacity-70">
          <span className="sr-only">Room code </span>
          {room.code}
        </span>
      )}

      <span className="ml-auto flex flex-wrap items-center gap-2">
        {showConn && (
          <span className={`sticker ${conn.tone}`} role="status">
            {conn.text}
          </span>
        )}
        {/* "Am I on the mock?" is a question a developer asks, on a desktop.
            It is not worth a row of a phone's lobby, and it is not worth any
            of the game screen. */}
        {!dense && room && transportKind === 'mock' && (
          <span className="sticker hidden bg-grape text-chill lg:inline-block" title="Playing against the built-in mock server">
            demo server
          </span>
        )}

        {onCastView && (
          <button
            type="button"
            onClick={() => onCastView(!castView)}
            aria-pressed={castView}
            className={[
              'rounded-full border-2 px-3 py-1.5 font-mono text-[0.625rem] tracking-[0.14em] uppercase',
              castView ? 'border-fanta bg-fanta text-ink' : 'border-ink/15 hover:bg-ink/6',
            ].join(' ')}
          >
            {/* "Cast view" is the second-longest thing in this bar; on anything
                narrower than a desktop the short form keeps the bar to one row. */}
            <span className="lg:hidden">Cast</span>
            <span className="hidden lg:inline">Cast view</span>
          </button>
        )}

        {onSameRoom && (
          <SameRoomToggle
            on={!!sameRoom}
            isHost={!!sameRoomIsHost}
            fromRoomDefault={sameRoomFromRoomDefault}
            onChange={onSameRoom}
          />
        )}

        <MuteControl
          muted={muted}
          volume={volume}
          onMuted={onMuted}
          onVolume={onVolume}
          musicVolume={musicVolume}
          onMusicVolume={onMusicVolume}
          sliders={!dense}
        />
      </span>
    </header>
  );
}
