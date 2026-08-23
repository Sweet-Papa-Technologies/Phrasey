import type { ActionCardKind } from '@phrasey/shared';

/** One bold, flat glyph per action card (§9). No icon font, no external assets. */
export function ActionIcon({ kind, className }: { kind: ActionCardKind; className?: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };

  switch (kind) {
    case 'SKIP':
      return (
        <svg {...common}>
          <path d="M5 5l8 7-8 7z" fill="currentColor" stroke="none" />
          <path d="M18 5v14" />
        </svg>
      );
    case 'REVERSE':
      return (
        <svg {...common}>
          <path d="M4 9h13a3 3 0 0 1 0 6h-3" />
          <path d="M7 6L4 9l3 3" />
          <path d="M17 18l3-3-3-3" />
        </svg>
      );
    case 'DOUBLE_DOWN':
      return (
        <svg {...common}>
          <path d="M12 4v13" />
          <path d="M7 12l5 5 5-5" />
          <path d="M6 20h12" />
        </svg>
      );
    case 'VOWEL_RUSH':
      return (
        <svg {...common}>
          <path d="M13 3L5 14h6l-1 7 8-11h-6z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'SHUFFLE':
      return (
        <svg {...common}>
          <path d="M4 6h4l8 12h4" />
          <path d="M4 18h4l3-4" />
          <path d="M17 3l3 3-3 3" />
          <path d="M17 15l3 3-3 3" />
        </svg>
      );
    case 'PEEK':
      return (
        <svg {...common}>
          <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" />
          <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'CRACK':
      return (
        <svg {...common}>
          <path d="M13 2L6 13h5l-1 9 8-12h-5z" />
        </svg>
      );
    case 'RELIEF_VALVE':
      return (
        <svg {...common}>
          <path d="M5 19h14" />
          <path d="M12 15V5" />
          <path d="M8 9l4-4 4 4" />
        </svg>
      );
    case 'VANDAL':
      return (
        <svg {...common}>
          <path d="M4 20L14 6" />
          <path d="M10 4l6 4" />
          <path d="M17 12l3 2-2 3-3-2z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'WILD':
      return (
        <svg {...common}>
          <path d="M12 3l2.4 5.4L20 9.6l-4 4 1 6-5-2.9L7 19.6l1-6-4-4 5.6-1.2z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'LOCKOUT':
      return (
        <svg {...common}>
          <rect x="4" y="10" width="16" height="10" rx="2.5" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
      );
    case 'SWIPE':
      return (
        <svg {...common}>
          <path d="M4 16l7-7" />
          <path d="M9 4l11 4-4 11-3-6z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'BLOCK':
      return (
        <svg {...common}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'BUZZ_IN':
      return (
        <svg {...common}>
          <circle cx="12" cy="13" r="7" />
          <path d="M12 13V9" />
          <path d="M9 3h6" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}
