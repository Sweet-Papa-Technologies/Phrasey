export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

import { formatRoomHandle } from '@phrasey/shared';

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The share link carries the room key as well as the code, so clicking a link
 * or scanning the QR stays a one-step join. Typing just the code gets you the
 * key prompt instead — see §6.6 and the anti-enumeration note in protocol.ts.
 */
export function joinUrl(code: string, key?: string | null): string {
  const path = key ? `/join/${formatRoomHandle(code, key)}` : `/join/${code}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
