/**
 * Board layout helpers.
 *
 * The one job that matters here: assign each cell the SAME flat index the
 * server uses in `positions` arrays (`letterPositions()` in @phrasey/shared —
 * every non-space character, in reading order). If these two ever disagree the
 * reveal cascade lights up the wrong tiles.
 */
import type { BoardCell, MaskedBoard } from '@phrasey/shared';

export interface RenderCell {
  cell: BoardCell;
  index: number;
}

export interface RenderWord {
  cells: RenderCell[];
  /** Index of this word within the board, for stable React keys. */
  wordIndex: number;
}

export function layoutBoard(board: Pick<MaskedBoard, 'words'>): RenderWord[] {
  let index = 0;
  return board.words.map((word, wordIndex) => ({
    wordIndex,
    cells: word.map((cell) => ({ cell, index: index++ })),
  }));
}

/** 0–1 share of letter tiles revealed. */
export function boardProgress(board: Pick<MaskedBoard, 'totalLetters' | 'hiddenLetters'>): number {
  if (board.totalLetters <= 0) return 0;
  return (board.totalLetters - board.hiddenLetters) / board.totalLetters;
}

/** The character a cell should render. Never invents one for a hidden tile. */
export function cellCharacter(cell: BoardCell): string {
  if (cell.t === 'punct') return cell.ch;
  return cell.revealed ? cell.ch : '';
}
