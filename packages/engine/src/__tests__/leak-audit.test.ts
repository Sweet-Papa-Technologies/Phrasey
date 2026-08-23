// A SECOND, independently-authored check of the section 6.2 invariant,
// deliberately not sharing helpers with mask-adversarial.test.ts. Two
// independent tests of the one thing the whole security model rests on.
// Original note: independent orchestrator check of the section 6.2 invariant. Deliberately
// does not reuse the engine's own leak-test helpers.
import { describe, it, expect } from 'vitest';
import { createMatch, applyAction, maskBoard, roundPublic, playerView } from '../index.js';
import { TEST_PUZZLES } from '../testing/fixtures.js';
import { normalizeGuess, normalizePuzzleText } from '@phrasey/shared';

describe('independent leak audit', () => {
  it('no broadcast-shaped payload contains the answer or a hidden letter', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const puzzle = TEST_PUZZLES[seed % TEST_PUZZLES.length]!;
      let st = createMatch({
        seed,
        players: [
          { id: 'p1', name: 'A', color: '#fff' },
          { id: 'p2', name: 'B', color: '#000' },
          { id: 'p3', name: 'C', color: '#111' },
        ],
        nowMs: 0,
      });
      st = applyAction(st, { type: 'startRound', puzzle }, 0).state;

      const answer = normalizePuzzleText(puzzle.text);
      const answerSquashed = normalizeGuess(puzzle.text);

      for (let step = 0; step < 60; step++) {
        const board = maskBoard(st);
        const round = roundPublic(st);
        const views = ['p1', 'p2', 'p3'].map((id) => playerView(st, id));

        // Which letters are still hidden right now?
        const revealed = new Set<string>();
        for (const w of board.words) for (const c of w) if (c.t === 'letter' && c.revealed) revealed.add(c.ch);
        const hidden = new Set([...answer].filter((ch) => /[A-Z]/.test(ch) && !revealed.has(ch)));

        for (const [label, payload] of [['board', board], ['round', round], ...views.map((v, i) => [`view${i}`, v] as const)] as const) {
          const json = JSON.stringify(payload);
          expect(json, `${label} contained the full answer`).not.toContain(answerSquashed);
          // Strip what is legitimately allowed to contain a letter:
          //  - public prose (category / hint / a11y text / player names)
          //  - the player's OWN hand (holding an L card says nothing about the
          //    puzzle — that is the whole premise of the game)
          //  - the player's OWN peeks (the PEEK card is a deliberate private reveal)
          //  - boardPattern, which encodes only already-guessed letters
          const stripped = JSON.stringify(payload, (k, v) =>
            k === 'category' || k === 'hint' || k === 'accessibleText' || k === 'name' ||
            k === 'persona' || k === 'botPersona' || k === 'hand' || k === 'cards' ||
            k === 'peeks' || k === 'boardPattern' || k === 'pattern'
              ? undefined
              : v,
          );
          for (const ch of hidden) {
            const re = new RegExp(`"${ch}"`);
            expect(re.test(stripped), `${label} exposed hidden letter ${ch} (seed ${seed}, step ${step})`).toBe(false);
          }
        }
        checked++;

        const cur = st.round?.currentPlayerId;
        if (!cur || !st.round) break;
        try {
          st = applyAction(st, { type: 'timeout' }, step * 1000).state;
        } catch { break; }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});
