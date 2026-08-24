/**
 * The join QR (§6.6) — one implementation, used by the lobby and by the cast
 * view, because the two places it appears want the same code at very different
 * sizes.
 *
 * Sizing is the whole point of this component. The QR now encodes a share link
 * carrying the room code *and* its key (`/join/KABO-M3XR`), which pushes it to
 * a higher version — more modules in the same square, so each module is
 * smaller than it used to be at the same pixel size. It is scanned by a phone
 * held across a living room, off a TV that an iPad is casting to. That is a
 * small, low-contrast, possibly moire-patterned target, and the reported
 * failure was exactly this: "not large enough for phone to see from afar".
 *
 * So the rendered bitmap is generated far larger than it is displayed rather
 * than being upscaled by the browser: a QR resampled up from 320px has soft
 * module edges, and soft edges are what a camera at four metres cannot
 * threshold. `renderPx` is deliberately independent of the CSS box.
 */
import { useEffect, useState } from 'react';
import QRCodeLib from 'qrcode';

export interface JoinQrProps {
  /** The full join URL to encode. */
  url: string;
  /** Roughly how large it will be drawn, in CSS px. Drives the bitmap size. */
  displayPx?: number;
  className?: string;
}

/**
 * Bitmap size for a given display size. Three device pixels per CSS pixel is
 * past every phone and tablet panel this runs on, and a QR is a two-colour PNG
 * — a 1280px one is a few tens of KB, which is nothing next to a scan that
 * fails.
 */
export function qrRenderPx(displayPx: number): number {
  const wanted = Math.ceil(Math.max(0, displayPx) * 3);
  return Math.min(1280, Math.max(640, wanted));
}

export function JoinQr({ url, displayPx = 320, className }: JoinQrProps) {
  const [qr, setQr] = useState<string | null>(null);
  const renderPx = qrRenderPx(displayPx);

  useEffect(() => {
    let alive = true;
    QRCodeLib.toDataURL(url, {
      margin: 1,
      width: renderPx,
      // §9 tokens rather than pure black/white: the code still reads, and it
      // does not look like a shipping label stuck onto the lobby.
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
  }, [url, renderPx]);

  if (!qr) {
    // Hold the space rather than letting the layout jump when it resolves.
    return <div aria-hidden="true" className={`rounded-card bg-ink/5 ${className ?? ''}`} />;
  }

  return (
    <img
      src={qr}
      alt={`QR code linking to ${url}`}
      width={renderPx}
      height={renderPx}
      className={`rounded-card border-2 border-ink/12 bg-chill ${className ?? ''}`}
    />
  );
}
