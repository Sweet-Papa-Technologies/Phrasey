import type { RoomPublic } from '@phrasey/shared';
import { Link } from '../lib/router';
import type { ConnectionState } from '../net/transport';
import { Logo } from './Logo';
import { MuteControl } from './MuteControl';

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
}

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
}: TopBarProps) {
  const conn = CONNECTION_COPY[connection];
  return (
    <header className="flex w-full flex-wrap items-center gap-3 px-4 py-3">
      <Link to="/" aria-label="Phrasey home">
        <Logo />
      </Link>

      {room && (
        <span className="font-mono text-sm font-bold tracking-[0.18em] opacity-70">
          <span className="sr-only">Room code </span>
          {room.code}
        </span>
      )}

      <span className="ml-auto flex flex-wrap items-center gap-2">
        {(room || connection !== 'idle') && (
          <span className={`sticker ${conn.tone}`} role="status">
            {conn.text}
          </span>
        )}
        {room && transportKind === 'mock' && (
          <span className="sticker bg-grape text-chill" title="Playing against the built-in mock server">
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
            Cast view
          </button>
        )}

        <MuteControl muted={muted} volume={volume} onMuted={onMuted} onVolume={onVolume} />
      </span>
    </header>
  );
}
