import {
  BOARD_SIZE,
  PIECE_COUNTS,
  RANK_VALUES,
  type BattleResult,
  type Board,
  type GameState,
  type Move,
  type Piece,
  type PieceKind,
  type PlayerColor,
  type Position,
} from './types';

const START_ROWS: Readonly<Record<PlayerColor, readonly number[]>> = {
  blue: [0, 1, 2, 3],
  red: [6, 7, 8, 9],
};

const LAKE_COORDINATES: ReadonlyArray<readonly [number, number]> = [
  [4, 2],
  [4, 3],
  [5, 2],
  [5, 3],
  [4, 6],
  [4, 7],
  [5, 6],
  [5, 7],
];

const LAKES = new Set(LAKE_COORDINATES.map(([row, col]) => `${row},${col}`));

export function setLakeLayout(layout: 'classic' | 'island' | 'river'): void {
  LAKES.clear();
  if (layout === 'classic') {
    LAKE_COORDINATES.forEach(([row, col]) => LAKES.add(`${row},${col}`));
  } else if (layout === 'island') {
    const coordinates = [
      [4, 4], [4, 5], [5, 4], [5, 5]
    ];
    coordinates.forEach(([row, col]) => LAKES.add(`${row},${col}`));
  } else if (layout === 'river') {
    const coordinates = [
      [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [4, 8],
      [5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8]
    ];
    coordinates.forEach(([row, col]) => LAKES.add(`${row},${col}`));
  }
}

const ORTHOGONAL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function positionToKey(position: Position): string {
  return `${position.row},${position.col}`;
}

export function keyToPosition(key: string): Position | null {
  const [rowRaw, colRaw] = key.split(',');
  const row = Number(rowRaw);
  const col = Number(colRaw);
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return null;
  }
  return { row, col };
}

export function opponentOf(player: PlayerColor): PlayerColor {
  return player === 'red' ? 'blue' : 'red';
}

export function isInsideBoard(position: Position): boolean {
  return (
    Number.isInteger(position.row) &&
    Number.isInteger(position.col) &&
    position.row >= 0 &&
    position.row < BOARD_SIZE &&
    position.col >= 0 &&
    position.col < BOARD_SIZE
  );
}

export function isLake(position: Position): boolean {
  return LAKES.has(positionToKey(position));
}

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

function isMovablePiece(kind: PieceKind): boolean {
  return kind !== 'flag' && kind !== 'bomb';
}

export function getPieceAt(board: Board, position: Position): Piece | null {
  if (!isInsideBoard(position)) {
    return null;
  }
  const row = board[position.row];
  if (!row) {
    return null;
  }
  return row[position.col] ?? null;
}

function setPieceAt(board: Board, position: Position, piece: Piece | null): void {
  const row = board[position.row];
  if (!row) {
    return;
  }
  row[position.col] = piece;
}

function createPiecePool(owner: PlayerColor): Piece[] {
  const pieces: Piece[] = [];
  for (const [kind, count] of Object.entries(PIECE_COUNTS) as Array<[PieceKind, number]>) {
    for (let index = 0; index < count; index += 1) {
      pieces.push({
        id: `${owner}-${kind}-${index}`,
        owner,
        kind,
        revealed: false,
      });
    }
  }
  return pieces;
}

function shuffle<T>(items: readonly T[]): T[] {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = clone[index];
    clone[index] = clone[swapIndex] as T;
    clone[swapIndex] = temp as T;
  }
  return clone;
}

function placePieces(board: Board, owner: PlayerColor): void {
  const rows = START_ROWS[owner];
  const setupSquares: Position[] = [];
  for (const row of rows) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      setupSquares.push({ row, col });
    }
  }

  const pool = shuffle(createPiecePool(owner));

  setupSquares.forEach((square, index) => {
    const piece = pool[index];
    if (!piece) {
      return;
    }
    setPieceAt(board, square, piece);
  });
}

export function createInitialGameState(): GameState {
  const board = createEmptyBoard();
  placePieces(board, 'blue');
  placePieces(board, 'red');

  return {
    board,
    currentPlayer: 'red',
    winner: null,
    moveCount: 0,
    history: [],
  };
}

function resolveBattle(attacker: Piece, defender: Piece): BattleResult {
  if (defender.kind === 'flag') {
    return 'attacker';
  }

  if (defender.kind === 'bomb') {
    return attacker.kind === 'miner' ? 'attacker' : 'defender';
  }

  if (attacker.kind === 'spy' && defender.kind === 'marshal') {
    return 'attacker';
  }

  const attackerRank = RANK_VALUES[attacker.kind];
  const defenderRank = RANK_VALUES[defender.kind];

  if (attackerRank > defenderRank) {
    return 'attacker';
  }

  if (attackerRank < defenderRank) {
    return 'defender';
  }

  return 'both';
}

function normalizePosition(position: Position, direction: readonly [number, number], step = 1): Position {
  return {
    row: position.row + direction[0] * step,
    col: position.col + direction[1] * step,
  };
}

export function getLegalMoves(state: GameState, from: Position): Position[] {
  if (state.winner) {
    return [];
  }

  const piece = getPieceAt(state.board, from);
  if (!piece || piece.owner !== state.currentPlayer || !isMovablePiece(piece.kind)) {
    return [];
  }

  const moves: Position[] = [];

  if (piece.kind === 'scout') {
    for (const direction of ORTHOGONAL_DIRECTIONS) {
      for (let step = 1; step < BOARD_SIZE; step += 1) {
        const target = normalizePosition(from, direction, step);
        if (!isInsideBoard(target) || isLake(target)) {
          break;
        }

        const targetPiece = getPieceAt(state.board, target);
        if (!targetPiece) {
          moves.push(target);
          continue;
        }

        if (targetPiece.owner !== piece.owner) {
          moves.push(target);
        }
        break;
      }
    }

    return moves;
  }

  for (const direction of ORTHOGONAL_DIRECTIONS) {
    const target = normalizePosition(from, direction);
    if (!isInsideBoard(target) || isLake(target)) {
      continue;
    }
    const targetPiece = getPieceAt(state.board, target);
    if (!targetPiece || targetPiece.owner !== piece.owner) {
      moves.push(target);
    }
  }

  return moves;
}

export function getAllLegalMoves(state: GameState, player: PlayerColor = state.currentPlayer): Move[] {
  const moves: Move[] = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const from = { row, col };
      const piece = getPieceAt(state.board, from);
      if (!piece || piece.owner !== player) {
        continue;
      }

      const normalizedState = player === state.currentPlayer ? state : { ...state, currentPlayer: player };
      for (const to of getLegalMoves(normalizedState, from)) {
        moves.push({ from, to });
      }
    }
  }

  return moves;
}

export function canPlayerMove(state: GameState, player: PlayerColor): boolean {
  return getAllLegalMoves(state, player).length > 0;
}

export function applyMove(state: GameState, move: Move): GameState {
  if (state.winner) {
    return state;
  }

  const legalTargets = getLegalMoves(state, move.from);
  const legalTargetKeys = new Set(legalTargets.map(positionToKey));
  if (!legalTargetKeys.has(positionToKey(move.to))) {
    return state;
  }

  const board = cloneBoard(state.board);
  const attacker = getPieceAt(board, move.from);
  if (!attacker) {
    return state;
  }

  const defender = getPieceAt(board, move.to);
  const nextHistory = [...state.history];
  const actor = attacker.owner.toUpperCase();

  setPieceAt(board, move.from, null);

  let winner: PlayerColor | null = state.winner;

  if (!defender) {
    setPieceAt(board, move.to, { ...attacker });
    nextHistory.push(`${actor}: ${attacker.kind} moved to ${positionToKey(move.to)}`);
  } else {
    const battleResult = resolveBattle(attacker, defender);
    const attackerPiece = { ...attacker };
    const defenderPiece = { ...defender };

    if (defender.kind === 'flag' && battleResult === 'attacker') {
      winner = attacker.owner;
    }

    if (battleResult === 'attacker') {
      setPieceAt(board, move.to, attackerPiece);
      nextHistory.push(
        `${actor}: ${attacker.kind} captured ${defender.owner.toUpperCase()} ${defender.kind} at ${positionToKey(move.to)}`,
      );
    } else if (battleResult === 'defender') {
      setPieceAt(board, move.to, defenderPiece);
      nextHistory.push(
        `${actor}: ${attacker.kind} lost to ${defender.owner.toUpperCase()} ${defender.kind} at ${positionToKey(move.to)}`,
      );
    } else {
      setPieceAt(board, move.to, null);
      nextHistory.push(`${actor}: ${attacker.kind} and ${defender.kind} were both removed at ${positionToKey(move.to)}`);
    }
  }

  const nextPlayer = opponentOf(state.currentPlayer);

  if (!winner) {
    const redCanMove = canPlayerMove({ ...state, board, currentPlayer: 'red' }, 'red');
    const blueCanMove = canPlayerMove({ ...state, board, currentPlayer: 'blue' }, 'blue');

    if (!redCanMove) {
      winner = 'blue';
    } else if (!blueCanMove) {
      winner = 'red';
    }
  }

  return {
    board,
    currentPlayer: winner ? state.currentPlayer : nextPlayer,
    winner,
    moveCount: state.moveCount + 1,
    history: nextHistory.slice(-30),
  };
}

export function serializeState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeState(serialized: string): GameState | null {
  try {
    const parsed = JSON.parse(serialized) as GameState;
    if (!parsed || !Array.isArray(parsed.board)) {
      return null;
    }
    if (parsed.board.length !== BOARD_SIZE) {
      return null;
    }
    if (!validateGameState(parsed).valid) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function isPieceKind(value: string): value is PieceKind {
  return value in PIECE_COUNTS;
}

function isPlayerColor(value: string): value is PlayerColor {
  return value === 'red' || value === 'blue';
}

function createZeroCounts(): Record<PieceKind, number> {
  return {
    flag: 0,
    bomb: 0,
    marshal: 0,
    general: 0,
    colonel: 0,
    major: 0,
    captain: 0,
    lieutenant: 0,
    sergeant: 0,
    miner: 0,
    scout: 0,
    spy: 0,
  };
}

export function validateGameState(state: GameState): ValidationResult {
  if (!Array.isArray(state.board) || state.board.length !== BOARD_SIZE) {
    return { valid: false, reason: 'Board must contain 10 rows.' };
  }

  if (!isPlayerColor(state.currentPlayer)) {
    return { valid: false, reason: 'Current player must be red or blue.' };
  }

  if (state.winner !== null && !isPlayerColor(state.winner)) {
    return { valid: false, reason: 'Winner must be null, red, or blue.' };
  }

  if (!Number.isInteger(state.moveCount) || state.moveCount < 0) {
    return { valid: false, reason: 'Move count must be a non-negative integer.' };
  }

  if (!Array.isArray(state.history)) {
    return { valid: false, reason: 'History must be an array.' };
  }

  const trackedCounts: Record<PlayerColor, Record<PieceKind, number>> = {
    red: createZeroCounts(),
    blue: createZeroCounts(),
  };

  for (let rowIndex = 0; rowIndex < BOARD_SIZE; rowIndex += 1) {
    const row = state.board[rowIndex];
    if (!Array.isArray(row) || row.length !== BOARD_SIZE) {
      return { valid: false, reason: `Row ${rowIndex} does not contain 10 columns.` };
    }

    for (let colIndex = 0; colIndex < BOARD_SIZE; colIndex += 1) {
      const cell = row[colIndex];
      if (cell === null) {
        continue;
      }

      if (
        typeof cell !== 'object' ||
        typeof cell.id !== 'string' ||
        !isPieceKind(cell.kind) ||
        !isPlayerColor(cell.owner) ||
        typeof cell.revealed !== 'boolean'
      ) {
        return { valid: false, reason: `Invalid piece payload at ${rowIndex},${colIndex}.` };
      }

      const owner = cell.owner;
      const kind = cell.kind;
      trackedCounts[owner][kind] += 1;

      if (trackedCounts[owner][kind] > PIECE_COUNTS[kind]) {
        return {
          valid: false,
          reason: `Too many ${owner} ${kind} pieces.`,
        };
      }
    }
  }

  return { valid: true };
}

export function countPiecesByOwner(board: Board): Record<PlayerColor, Record<PieceKind, number>> {
  const counts: Record<PlayerColor, Record<PieceKind, number>> = {
    red: createZeroCounts(),
    blue: createZeroCounts(),
  };

  for (const row of board) {
    for (const cell of row) {
      if (!cell) {
        continue;
      }
      counts[cell.owner][cell.kind] += 1;
    }
  }

  return counts;
}
