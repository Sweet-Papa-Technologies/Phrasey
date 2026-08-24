/**
 * The solve box, driven the way a player drives it. The pure arithmetic is
 * covered in `lib/solveInput.test.ts`; this covers the wiring — one real input,
 * blanks only, Enter and the button both submit, and the two lock reasons.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { accessibleBoardText, buildWords, normalizeGuess, type MaskedBoard } from '@phrasey/shared';
import { SolveBox } from './SolveBox';

const ANSWER = "DON'T STOP";

function makeBoard(revealed: string[]): MaskedBoard {
  const words = buildWords(ANSWER, new Set(revealed));
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
    category: 'Bumper sticker',
    words,
    guessedLetters: revealed,
    missedLetters: [],
    totalLetters: total,
    hiddenLetters: hidden,
    hint: null,
    accessibleText: accessibleBoardText(words),
  };
}

function setup(overrides: Partial<React.ComponentProps<typeof SolveBox>> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const board = overrides.board ?? makeBoard(['O']);
  render(
    <SolveBox
      open
      board={board}
      hiddenLetters={'hiddenLetters' in overrides ? (overrides.hiddenLetters as number) : 6}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSubmit, onCancel };
}

describe('SolveBox', () => {
  it('renders one blank per hidden letter and pre-fills what the board revealed', () => {
    setup();
    // DON'T STOP with O revealed: D N T S T P are blank, both O's are fixed.
    expect(screen.getAllByTestId('solve-blank')).toHaveLength(6);
    expect(screen.getAllByTestId('solve-fixed').map((n) => n.textContent)).toEqual(['O', 'O']);
    expect(screen.getAllByTestId('solve-punct').map((n) => n.textContent)).toEqual(["'"]);
  });

  it('says punctuation and spacing do not matter, so nobody has to wonder', () => {
    setup();
    expect(screen.getByText(/punctuation and spacing are ignored/i)).toBeTruthy();
  });

  it('has exactly one real input — the OTP pattern, not one field per blank', () => {
    const { container } = render(
      <SolveBox open board={makeBoard(['O'])} hiddenLetters={6} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.querySelectorAll('input')).toHaveLength(1);
  });

  it('does not zoom iOS: the real input is at least 16px', () => {
    const { container } = render(
      <SolveBox open board={makeBoard(['O'])} hiddenLetters={6} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    const input = container.querySelector('input');
    // `text-base` is 1rem = 16px, the threshold Safari zooms below.
    expect(input?.className).toMatch(/\btext-base\b/);
    expect(input?.getAttribute('inputmode')).toBe('text');
    expect(input?.getAttribute('autocapitalize')).toBe('characters');
    expect(input?.getAttribute('autocomplete')).toBe('off');
    expect(input?.getAttribute('spellcheck')).toBe('false');
  });

  it('fills only the blanks as you type, and submits the whole phrase', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    const input = screen.getByRole('textbox');
    await user.click(input);
    await user.keyboard('DNTSTP');

    expect(screen.getAllByTestId('solve-blank').map((n) => n.textContent)).toEqual(['D', 'N', 'T', 'S', 'T', 'P']);

    await user.click(screen.getByRole('button', { name: /lock it in/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(normalizeGuess(String(onSubmit.mock.calls[0]?.[0]))).toBe(normalizeGuess(ANSWER));
  });

  it('submits on Enter as well as on the button', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('DNTSTP{Enter}');
    expect(onSubmit).toHaveBeenCalledWith("DON'T STOP");
  });

  it('swallows punctuation and spaces outright — there is no blank for them', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard("D'N T.S");
    expect(screen.getAllByTestId('solve-blank').map((n) => n.textContent)).toEqual(['D', 'N', 'T', 'S', '', '']);
  });

  it('backspaces a letter at a time', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('DNT{Backspace}{Backspace}');
    expect(screen.getAllByTestId('solve-blank').map((n) => n.textContent)).toEqual(['D', '', '', '', '', '']);
  });

  it('will not submit a half-filled phrase', async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('DNT');
    const submit = screen.getByRole('button', { name: /lock it in/i });
    expect(submit).toHaveProperty('disabled', true);
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('announces the cursor position (§10)', async () => {
    const user = userEvent.setup();
    setup();
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('aria-label')).toBe('Missing letter 1 of 6, blank');
    await user.click(input);
    await user.keyboard('DN');
    expect(input.getAttribute('aria-label')).toBe('Missing letter 3 of 6, blank');
  });

  it('marks the active blank so the focus indicator has somewhere to go', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('D');
    const active = screen.getAllByTestId('solve-blank').filter((n) => n.getAttribute('data-active') === 'true');
    expect(active).toHaveLength(1);
    expect(active[0]).toBe(screen.getAllByTestId('solve-blank')[1]);
  });

  it('cancels on Escape', async () => {
    const user = userEvent.setup();
    const { onCancel } = setup();
    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('needs no typing at all when the board is fully revealed', () => {
    setup({ board: makeBoard('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), hiddenLetters: 0 });
    expect(screen.queryAllByTestId('solve-blank')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /lock it in/i })).toHaveProperty('disabled', false);
  });

  it('is inert and explains why when the round lockout applies (§3.3)', () => {
    setup({ lockReason: 'round' });
    expect(screen.getByRole('alert').textContent).toMatch(/rest of this round/i);
    expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: /lock it in/i })).toHaveProperty('disabled', true);
  });

  it('is inert and names the card when a LOCKOUT applies (§3.5)', () => {
    setup({ lockReason: 'turn' });
    expect(screen.getByRole('alert').textContent).toMatch(/lockout card/i);
    expect(screen.getByRole('alert').textContent).toMatch(/this turn/i);
    expect(screen.getByRole('button', { name: /lock it in/i })).toHaveProperty('disabled', true);
  });

  it('renders nothing when closed', () => {
    render(<SolveBox open={false} board={makeBoard([])} hiddenLetters={9} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
