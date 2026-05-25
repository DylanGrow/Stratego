import { describe, expect, it } from 'vitest';

import {
  applyMove,
  countPiecesByOwner,
  createEmptyBoard,
  createInitialGameState,
  deserializeState,
  getLegalMoves,
  keyToPosition,
  validateGameState,
} from '../src/game/engine';
import type { GameState, Piece, PieceKind, PlayerColor } from '../src/game/types';

function makePiece(owner: PlayerColor, kind: PieceKind, id: string): Piece {
  return {
    id,
    owner,
    kind,
    revealed: false,
  };
}

function makeState(currentPlayer: PlayerColor = 'red'): GameState {
  return {
    board: createEmptyBoard(),
    currentPlayer,
    winner: null,
    moveCount: 0,
    history: [],
  };
}

describe('engine fundamentals', () => {
  it('creates a complete initial state for both players', () => {
    const state = createInitialGameState();
    const counts = countPiecesByOwner(state.board);

    const redTotal = Object.values(counts.red).reduce((sum, value) => sum + value, 0);
    const blueTotal = Object.values(counts.blue).reduce((sum, value) => sum + value, 0);

    expect(redTotal).toBe(40);
    expect(blueTotal).toBe(40);
    expect(state.currentPlayer).toBe('red');
  });

  it('prevents immovable pieces from having legal moves', () => {
    const state = makeState('red');
    state.board[6]![4] = makePiece('red', 'flag', 'red-flag');

    const moves = getLegalMoves(state, { row: 6, col: 4 });
    expect(moves).toHaveLength(0);
  });

  it('lets a scout move multiple squares until blocked', () => {
    const state = makeState('red');
    state.board[6]![4] = makePiece('red', 'scout', 'red-scout');
    state.board[6]![7] = makePiece('blue', 'sergeant', 'blue-sergeant');
    state.board[4]![4] = makePiece('red', 'captain', 'red-captain');

    const moves = getLegalMoves(state, { row: 6, col: 4 });

    expect(moves).toContainEqual({ row: 6, col: 5 });
    expect(moves).toContainEqual({ row: 6, col: 6 });
    expect(moves).toContainEqual({ row: 6, col: 7 });
    expect(moves).not.toContainEqual({ row: 3, col: 4 });
  });

  it('allows miner to defuse bombs', () => {
    const state = makeState('red');
    state.board[6]![0] = makePiece('red', 'miner', 'red-miner');
    state.board[5]![0] = makePiece('blue', 'bomb', 'blue-bomb');

    const next = applyMove(state, {
      from: { row: 6, col: 0 },
      to: { row: 5, col: 0 },
    });

    expect(next.board[5]![0]?.kind).toBe('miner');
  });

  it('eliminates both pieces on equal rank battles', () => {
    const state = makeState('red');
    state.board[6]![1] = makePiece('red', 'captain', 'red-captain');
    state.board[5]![1] = makePiece('blue', 'captain', 'blue-captain');

    const next = applyMove(state, {
      from: { row: 6, col: 1 },
      to: { row: 5, col: 1 },
    });

    expect(next.board[5]![1]).toBeNull();
  });

  it('sets winner when a flag is captured', () => {
    const state = makeState('red');
    state.board[6]![4] = makePiece('red', 'marshal', 'red-marshal');
    state.board[5]![4] = makePiece('blue', 'flag', 'blue-flag');

    const next = applyMove(state, {
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    });

    expect(next.winner).toBe('red');
  });

  it('rejects malformed state payloads through validation', () => {
    const state = makeInitialCorruptState();
    const validation = validateGameState(state);

    expect(validation.valid).toBe(false);
    expect(validation.reason).toMatch(/Too many red marshal pieces/);
  });

  it('wins the game when opponent has no movable pieces left', () => {
    const state = makeState('red');
    state.board[6]![4] = makePiece('red', 'miner', 'red-miner');
    state.board[0]![0] = makePiece('blue', 'flag', 'blue-flag');
    state.board[0]![1] = makePiece('blue', 'bomb', 'blue-bomb');
    state.board[0]![2] = makePiece('blue', 'bomb', 'blue-bomb-2');

    const next = applyMove(state, {
      from: { row: 6, col: 4 },
      to: { row: 5, col: 4 },
    });

    expect(next.winner).toBe('red');
  });

  it('marks invalid metadata fields during validation', () => {
    const state = makeState('red');
    state.board[0]![0] = makePiece('red', 'flag', 'red-flag');
    state.board[9]![9] = makePiece('blue', 'flag', 'blue-flag');

    (state as unknown as { moveCount: number }).moveCount = -1;

    const validation = validateGameState(state);
    expect(validation.valid).toBe(false);
    expect(validation.reason).toContain('Move count');
  });

  it('rejects malformed deserialized payloads', () => {
    expect(deserializeState('not-json')).toBeNull();

    const malformed = JSON.stringify({
      board: Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => null)),
      currentPlayer: 'red',
      winner: null,
      moveCount: 0,
      history: 'wrong-type',
    });

    expect(deserializeState(malformed)).toBeNull();
  });

  it('parses coordinate keys safely', () => {
    expect(keyToPosition('6,4')).toEqual({ row: 6, col: 4 });
    expect(keyToPosition('nope')).toBeNull();
    expect(keyToPosition('4,nope')).toBeNull();
  });
});

function makeInitialCorruptState(): GameState {
  const state = makeState('red');
  state.board[0]![0] = makePiece('red', 'marshal', 'r-m-1');
  state.board[0]![1] = makePiece('red', 'marshal', 'r-m-2');
  return state;
}
