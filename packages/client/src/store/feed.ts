/**
 * Turn engine events into the event feed (§ "event feed" in the game screen).
 * Pure, so the wording can be tested and so the feed never depends on render
 * order. Never prints anything the server did not send — in particular there is
 * no branch here that can print an unrevealed letter.
 */
import { ACTION_CARD_META, type GameEvent } from '@phrasey/shared';

export type FeedTone = 'neutral' | 'good' | 'bad' | 'big';

export interface FeedItem {
  id: string;
  tone: FeedTone;
  text: string;
  /** Player whose color should tint the entry, if any. */
  playerId?: string;
  at: number;
}

export type NameLookup = (playerId: string | null | undefined) => string;

let seq = 0;

export function feedItemsFor(events: readonly GameEvent[], nameOf: NameLookup, at = Date.now()): FeedItem[] {
  const out: FeedItem[] = [];
  const push = (tone: FeedTone, text: string, playerId?: string) => {
    out.push({ id: `f${++seq}`, tone, text, playerId, at });
  };

  for (const e of events) {
    switch (e.t) {
      case 'round:start':
        push('big', `Round ${e.roundNumber} — ${e.category}`);
        break;
      case 'letter:hit':
        push(
          'good',
          `${nameOf(e.playerId)} played ${e.letter} — ${e.occurrences}× for ${e.points}`,
          e.playerId,
        );
        break;
      case 'letter:miss':
        push('bad', `${nameOf(e.playerId)} played ${e.letter} — no ${e.letter}. Pressure +${e.pressureDelta}`, e.playerId);
        break;
      case 'reveal':
        if (e.reason === 'vowel-rush') push('good', `Vowel Rush: ${e.letters.join(', ')}`);
        break;
      case 'breath':
        push('neutral', `The board breathes — a free ${e.letter}`);
        break;
      case 'pressure':
        if (e.delta < 0) push('good', `Pressure ${e.delta} — ${e.cause}`, e.byPlayerId ?? undefined);
        break;
      case 'blowout':
        push('big', `BLOWOUT. ${nameOf(e.byPlayerId)} takes ${e.penalty}.`, e.byPlayerId ?? undefined);
        break;
      case 'solve:success':
        push('big', `${nameOf(e.playerId)} solved it for ${e.points}`, e.playerId);
        break;
      case 'solve:fail':
        push('bad', `${nameOf(e.playerId)} guessed wrong — locked out, pressure +${e.pressureDelta}`, e.playerId);
        break;
      case 'discard':
        push('neutral', `${nameOf(e.playerId)} discarded ${e.count}`, e.playerId);
        break;
      case 'skip':
        push('neutral', `${nameOf(e.playerId)} skipped ${nameOf(e.skippedPlayerId)}`, e.playerId);
        break;
      case 'reverse':
        push('neutral', `${nameOf(e.playerId)} reversed play`, e.playerId);
        break;
      case 'shuffle':
        push('neutral', 'Everybody passes their hand along');
        break;
      case 'crack':
        push('good', `Hint cracked open: “${e.hint}”`, e.playerId);
        break;
      case 'peek':
        push('neutral', `${nameOf(e.playerId)} peeked at a tile`, e.playerId);
        break;
      case 'lockout':
        push('bad', `${nameOf(e.playerId)} locked out ${nameOf(e.targetPlayerId)}`, e.playerId);
        break;
      case 'swipe':
        push('bad', `${nameOf(e.playerId)} swiped ${e.points} from ${nameOf(e.fromPlayerId)}`, e.playerId);
        break;
      case 'buzz':
        push('neutral', `${nameOf(e.playerId)} buzzed in`, e.playerId);
        break;
      case 'card:played':
        if (e.card.kind === 'action' && e.card.action !== 'WILD') {
          push('neutral', `${nameOf(e.playerId)} played ${ACTION_CARD_META[e.card.action].name}`, e.playerId);
        }
        break;
      case 'notice':
        push('neutral', e.message);
        break;
      default:
        break;
    }
  }
  return out;
}
