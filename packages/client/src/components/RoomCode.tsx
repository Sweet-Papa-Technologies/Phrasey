/**
 * §6.6: display the room code huge for screen sharing, with a QR code alongside
 * for in-person play, and a copyable share link.
 *
 * The QR is the primary join path for people in the same room, and the
 * playtest found it far too small to scan off a TV from across a lounge. It is
 * now the largest element on the lobby — the code and the link sit beside it
 * rather than the other way round — and the bitmap behind it is rendered at
 * several times its display size so the modules stay hard-edged (`JoinQr`).
 */
import { useEffect, useState } from 'react';
import { copyText, joinUrl } from '../lib/format';
import { JoinQr } from './JoinQr';

export interface RoomCodeProps {
  code: string;
  /** Included in the share link and the QR so a click or a scan still joins in one step. */
  roomKey?: string | null;
  compact?: boolean;
}

export function RoomCode({ code, roomKey = null, compact = false }: RoomCodeProps) {
  const url = joinUrl(code, roomKey);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <div
      className={[
        'flex min-w-0 flex-col-reverse items-center gap-5',
        // Code on the left, QR on the right, once there are two columns to
        // have. Below that the QR goes *first* in reading order: in the room
        // together — which is where a QR is any use at all — it is the thing
        // everyone is pointing a phone at.
        compact ? 'sm:flex-row sm:items-center' : 'sm:flex-row sm:items-center sm:gap-8',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1 text-center sm:text-left">
        <p className="sticker mb-1 bg-ink text-chill">Room code</p>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(code)) setCopied('code');
          }}
          aria-label={`Room code ${code.split('').join(' ')}. Copy code.`}
          className={`block w-full font-mono leading-none font-extrabold tracking-[0.08em] sm:w-auto ${
            compact ? 'text-4xl' : 'text-[clamp(2.75rem,11vw,6rem)]'
          }`}
        >
          {code}
        </button>
        <p className="mt-1 font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-55">
          {copied === 'code' ? 'Copied' : 'Say it out loud — it is pronounceable'}
        </p>

        {/*
          `min-w-0` all the way down, and the URL truncates rather than setting
          the width. Without it the invite link — which grew a room key — is the
          widest thing on a phone and pushes the whole lobby off the screen.
        */}
        <div className="mt-4 flex min-w-0 flex-col items-stretch gap-2 sm:items-start">
          <code className="block w-full truncate rounded-lg bg-ink/6 px-2 py-1 text-center font-mono text-xs sm:text-left">
            {url}
          </code>
          <button
            type="button"
            onClick={async () => {
              if (await copyText(url)) setCopied('link');
            }}
            className="rounded-full bg-grape px-4 py-2 text-sm font-bold text-chill shadow-pop"
          >
            {copied === 'link' ? 'Link copied' : 'Copy invite link'}
          </button>
        </div>
      </div>

      {/*
        Sized off the *viewport* rather than a fixed pixel count: the lobby is
        read on a phone held at arm's length and on an iPad thrown at a TV, and
        the same 128px square cannot serve both. It never exceeds the column it
        is in, so the zero-horizontal-overflow guarantee still holds.
      */}
      <div className="flex w-full shrink-0 justify-center sm:w-auto">
        <JoinQr
          url={url}
          displayPx={compact ? 176 : 320}
          className={
            compact
              ? 'h-[clamp(8rem,26vw,11rem)] w-[clamp(8rem,26vw,11rem)]'
              : 'h-[min(74vw,clamp(13rem,30vw,20rem))] w-[min(74vw,clamp(13rem,30vw,20rem))]'
          }
        />
      </div>
    </div>
  );
}
