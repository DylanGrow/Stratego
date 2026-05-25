import { getAllLegalMoves, getPieceAt } from './engine';
import type { GameState, Move, PlayerColor, Piece } from './types';
import { RANK_VALUES } from './types';

function getLocalBattleOutcome(
  attacker: Piece,
  defender: Piece
): 'attacker' | 'defender' | 'both' {
  if (defender.kind === 'flag') return 'attacker';
  if (defender.kind === 'bomb') return attacker.kind === 'miner' ? 'attacker' : 'defender';
  if (attacker.kind === 'spy' && defender.kind === 'marshal') return 'attacker';
  
  const aRank = RANK_VALUES[attacker.kind];
  const dRank = RANK_VALUES[defender.kind];
  if (aRank > dRank) return 'attacker';
  if (aRank < dRank) return 'defender';
  return 'both';
}

export function chooseRandomMove(state: GameState, player: PlayerColor): Move | null {
  const moves = getAllLegalMoves(state, player);
  if (moves.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * moves.length);
  return moves[index] ?? null;
}

export function chooseHeuristicMove(
  state: GameState,
  player: PlayerColor,
  personality: 'balanced' | 'rusher' | 'turtler' = 'balanced'
): Move | null {
  const moves = getAllLegalMoves(state, player);
  if (moves.length === 0) {
    return null;
  }

  let bestMove: Move | null = null;
  let bestScore = -Infinity;

  for (const move of moves) {
    let score = 0;
    const attacker = getPieceAt(state.board, move.from);
    const defender = getPieceAt(state.board, move.to);

    if (!attacker) continue;

    // 1. Battle evaluation
    if (defender) {
      const outcome = getLocalBattleOutcome(attacker, defender);
      if (defender.kind === 'flag' && outcome === 'attacker') {
        score += 100000; // Instantly capture Flag to win
      } else if (outcome === 'attacker') {
        const targetValue = RANK_VALUES[defender.kind] || 0;
        score += (targetValue + 2) * 60; // Reward capture

        if (attacker.kind === 'spy' && defender.kind === 'marshal') {
          score += 1200; // Spy backstab Marshall is premium
        }
        if (attacker.kind === 'miner' && defender.kind === 'bomb') {
          score += 900; // Defusing bomb
        }
      } else if (outcome === 'both') {
        const targetValue = RANK_VALUES[defender.kind] || 0;
        const myValue = RANK_VALUES[attacker.kind] || 0;
        if (targetValue >= myValue) {
          score += targetValue * 25;
        } else {
          score -= 60;
        }
      } else {
        score -= 250; // Suicide is highly discouraged
      }
    }

    // 2. Positional heuristic (Blue AI moves DOWN, row index increases)
    if (!defender) {
      const rowDiff = move.to.row - move.from.row;
      if (rowDiff > 0) {
        score += 12; // Advance forward
        
        // Rusher personality rewards aggressive forward pushes even more!
        if (personality === 'rusher') {
          score += 8;
        }
      } else if (rowDiff < 0) {
        score -= 6; // Retreat slightly penalized unless necessary
        
        // Rusher hates retreating
        if (personality === 'rusher') {
          score -= 4;
        }
      }

      // Turtler personality penalizes crossing the lake line (row 4/5) aggressively
      if (personality === 'turtler') {
        if (move.to.row >= 4) {
          score -= 15; // Turtler prefers staying in their own back lines
        } else {
          score += 5; // Reward staying behind
        }
      }
      
      // Random jitter to avoid gridlock repetitions
      score += Math.random() * 6;
    }

    // Additional personality modifiers
    if (personality === 'rusher' && attacker.kind === 'scout') {
      score += 4; // Rusher loves using scouts for reconnaissance
    }

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  if (bestMove === null || bestScore === -Infinity) {
    const idx = Math.floor(Math.random() * moves.length);
    return moves[idx] ?? null;
  }

  return bestMove;
}

export function chooseMove(
  state: GameState,
  player: PlayerColor,
  difficulty: 'recruit' | 'commander' = 'commander',
  personality: 'balanced' | 'rusher' | 'turtler' = 'balanced'
): Move | null {
  if (difficulty === 'recruit') {
    return chooseRandomMove(state, player);
  }
  return chooseHeuristicMove(state, player, personality);
}
