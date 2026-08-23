/**
 * Board rendering, and the one test this client cannot be allowed to fail:
 * an unrevealed cell must never render a character.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { accessibleBoardText, buildWords, type MaskedBoard } from '@phrasey/shared';
import { letterPositions } from '@phrasey/shared';
import { Board } from './Board';
import { layoutBoard } from '../lib/board';
import { cascadeDelayMap, planRevealCascade } from '../lib/reveal';

const ANSWER = "DON'T MICROWAVE THE POUCH";

function makeBoard(revealed: string[]): MaskedBoard {
  const set = new Set(revealed);
  const words = buildWords(ANSWER, set);
  let total = 0;
  let hidden = 0;
  for (const w of words) {
    for (const c of w) {
      if (c.t !== 'letter') continue;
      total++;
      if (!c.revealed) hidden++;
    }
  }
  return {
    category: 'Instructions on the back of a box',
    words,
    guessedLetters: revealed,
    missedLetters: [],
    totalLetters: total,
    hiddenLetters: hidden,
    hint: null,
    accessibleText: accessibleBoardText(words),
  };
}

describe('Board', () => {
  it('renders one tile per letter cell and keeps punctuation visible (§3.1)', () => {
    render(<Board board={makeBoard([])} />);
    const tiles = screen.getAllByTestId('tile');
    expect(tiles).toHaveLength(makeBoard([]).totalLetters);
    // The apostrophe in DON'T is shown, not masked.
    expect(screen.getAllByTestId('punct').map((n) => n.textContent)).toEqual(["'"]);
  });

  it('NEVER renders a character for an unrevealed cell', () => {
    render(<Board board={makeBoard(['O', 'E'])} />);
    for (const tile of screen.getAllByTestId('tile')) {
      if (tile.getAttribute('data-revealed') === 'true') continue;
      expect(tile.textContent).toBe('');
    }
  });

  it('renders only the letters the server actually revealed', () => {
    render(<Board board={makeBoard(['O'])} />);
    const shown = screen
      .getAllByTestId('tile')
      .filter((t) => t.getAttribute('data-revealed') === 'true')
      .map((t) => t.textContent);
    expect(new Set(shown)).toEqual(new Set(['O']));
    expect(shown).toHaveLength(3); // DON'T, MICROWAVE, POUCH — one O each
  });

  it('exposes an accessible text representation of the revealed state (§10)', () => {
    const board = makeBoard(['O']);
    render(<Board board={board} />);
    expect(board.accessibleText).toContain('_');
    expect(board.accessibleText).toContain('O');
    // Nothing hidden leaks into the a11y string either.
    expect(board.accessibleText).not.toContain('M');
    expect(screen.getByText(new RegExp(`Board reads:`))).toBeTruthy();
  });

  it('labels the region and shows the category', () => {
    render(<Board board={makeBoard([])} />);
    expect(screen.getByRole('region', { name: 'Puzzle board' })).toBeTruthy();
    expect(screen.getByText('Instructions on the back of a box')).toBeTruthy();
  });

  it('shows a peeked tile without marking it revealed', () => {
    const board = makeBoard([]);
    const idx = layoutBoard(board)[0]?.cells[0]?.index ?? 0;
    render(<Board board={board} peeks={{ [idx]: 'D' }} />);
    const tile = screen.getAllByTestId('tile')[0]!;
    expect(tile.getAttribute('data-revealed')).toBe('false');
    expect(tile.textContent).toBe('D');
    expect(tile.querySelector('[title="You peeked at this tile"]')).toBeTruthy();
  });

  it('renders the dead-letter list from missedLetters', () => {
    const board = { ...makeBoard(['O']), missedLetters: ['Q', 'Z'] };
    render(<Board board={board} />);
    expect(screen.getByText('Q')).toBeTruthy();
    expect(screen.getByText('Z')).toBeTruthy();
  });
});

describe('layoutBoard index space', () => {
  it('agrees with letterPositions() from the shared package', () => {
    const board = makeBoard([]);
    const clientIndexes = layoutBoard(board)
      .flatMap((w) => w.cells)
      .filter((c) => c.cell.t === 'letter')
      .map((c) => c.index);
    expect(clientIndexes).toEqual(letterPositions(ANSWER));
  });

  it('lines the cascade up with the tiles the server named', () => {
    const board = makeBoard(['O']);
    const positions = letterPositions(ANSWER).filter((_, i) => i % 5 === 0);
    const delays = cascadeDelayMap(planRevealCascade(positions));
    const cells = layoutBoard(board).flatMap((w) => w.cells);
    for (const p of positions) {
      expect(cells.find((c) => c.index === p)?.cell.t).toBe('letter');
      expect(delays.has(p)).toBe(true);
    }
  });
});
