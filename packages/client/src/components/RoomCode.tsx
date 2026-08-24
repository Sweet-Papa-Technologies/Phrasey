/**
 * §6.6: display the room code huge for screen sharing, with a QR code alongside
 * for in-person play, and a copyable share link.
 */
import { useEffect, useState } from 'react';
import QRCodeLib from 'qrcode';
import { copyText, joinUrl } from '../lib/format';

export interface RoomCodeProps {
  code: string;
  /** Included in the share link and the QR so a click or a scan still joins in one step. */
  roomKey?: string | null;
  compact?: boolean;
}

export function RoomCode({ code, roomKey = null, compact = false }: RoomCodeProps) {
  const url = joinUrl(code, roomKey);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  useEffect(() => {
    let alive = true;
    QRCodeLib.toDataURL(url, {
      margin: 1,
      width: 320,
      color: { dark: '#14121FFF', light: '#EAF4F7FF' },
      errorCorrectionLevel: 'M',
    })
      .then((d) => {
        if (alive) setQr(d);
      })
      .catch(() => {
        if (alive) setQr(null);
      });
    return () => {
      alive = false;
    };
  }, [url]);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-5 ${compact ? '' : 'sm:gap-8'}`}>
      <div className="min-w-0">
        <p className="sticker mb-1 bg-ink text-chill">Room code</p>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(code)) setCopied('code');
          }}
          aria-label={`Room code ${code.split('').join(' ')}. Copy code.`}
          className={`block font-mono leading-none font-extrabold tracking-[0.08em] ${
            compact ? 'text-5xl' : 'text-[clamp(3.25rem,13vw,8rem)]'
          }`}
        >
          {code}
        </button>
        <p className="mt-1 font-mono text-[0.625rem] tracking-[0.14em] uppercase opacity-55">
          {copied === 'code' ? 'Copied' : 'Say it out loud — it is pronounceable'}
        </p>
      </div>

      {/*
        `min-w-0` all the way down, and the URL truncates rather than setting
        the width. Without it the invite link — which grew a room key — is the
        widest thing on a phone and pushes the whole lobby off the screen.
      */}
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
        {qr && (
          <img
            src={qr}
            alt={`QR code linking to ${url}`}
            className={`shrink-0 rounded-card border-2 border-ink/12 ${
              compact ? 'h-24 w-24' : 'h-32 w-32 sm:h-40 sm:w-40'
            }`}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          <code className="block w-full truncate rounded-lg bg-ink/6 px-2 py-1 font-mono text-xs">{url}</code>
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
    </div>
  );
}
