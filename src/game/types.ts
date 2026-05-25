export const BOARD_SIZE = 10;

export type PlayerColor = 'red' | 'blue';

export type PieceKind =
  | 'flag'
  | 'bomb'
  | 'marshal'
  | 'general'
  | 'colonel'
  | 'major'
  | 'captain'
  | 'lieutenant'
  | 'sergeant'
  | 'miner'
  | 'scout'
  | 'spy';

export interface Piece {
  id: string;
  kind: PieceKind;
  owner: PlayerColor;
  revealed: boolean;
}

export type BoardCell = Piece | null;
export type Board = BoardCell[][];

export interface Position {
  row: number;
  col: number;
}

export interface Move {
  from: Position;
  to: Position;
}

export type BattleResult = 'attacker' | 'defender' | 'both';

export interface GameState {
  board: Board;
  currentPlayer: PlayerColor;
  winner: PlayerColor | null;
  moveCount: number;
  history: string[];
}

export const PIECE_COUNTS: Readonly<Record<PieceKind, number>> = {
  flag: 1,
  bomb: 6,
  marshal: 1,
  general: 1,
  colonel: 2,
  major: 3,
  captain: 4,
  lieutenant: 4,
  sergeant: 4,
  miner: 5,
  scout: 8,
  spy: 1,
};

export const RANK_VALUES: Readonly<Record<PieceKind, number>> = {
  flag: 0,
  bomb: 11,
  spy: 1,
  scout: 2,
  miner: 3,
  sergeant: 4,
  lieutenant: 5,
  captain: 6,
  major: 7,
  colonel: 8,
  general: 9,
  marshal: 10,
};
