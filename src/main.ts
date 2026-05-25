import './styles/globals.css';

import { chooseMove } from './game/ai';
import {
  applyMove,
  cloneBoard,
  countPiecesByOwner,
  createInitialGameState,
  deserializeState,
  getLegalMoves,
  isLake,
  positionToKey,
  serializeState,
  validateGameState,
  setLakeLayout,
  createEmptyBoard,
} from './game/engine';
import { RANK_VALUES, PIECE_COUNTS, type GameState, type PieceKind, type Position, type PlayerColor, type Board, type Piece, type Move } from './game/types';
import { sanitizePlayerName } from './security/sanitizer';
import { createMultiplayerService } from './services/multiplayer';
import { SessionManager } from './services/sessionManager';
import { readRuntimeConfig } from './config/runtime';
import { captureException, getErrorQueueDepth, installGlobalErrorHandlers } from './observability/errors';
import {
  createLogger,
  getActiveLogLevel,
  getRecentLogs,
  initializeLogging,
  subscribeToLogs,
  type LogEvent,
} from './observability/logger';

const PIECE_SYMBOLS: Readonly<Record<PieceKind, string>> = {
  flag: '🚩',
  bomb: '💣',
  marshal: '👑',
  general: '⭐',
  colonel: '🦅',
  major: '🎖️',
  captain: '⚓',
  lieutenant: '🗡️',
  sergeant: '🎗️',
  miner: '⛏️',
  scout: '🏹',
  spy: '🕵️',
};

const STORAGE_KEY = 'stratego-local-state-v1';

const runtime = readRuntimeConfig();
const query = new URLSearchParams(window.location.search);
const forceRenderCrash = runtime.debugMode && query.get('forceRenderCrash') === '1';
initializeLogging(runtime.logLevel);
const logger = createLogger('ui');

installGlobalErrorHandlers({
  release: runtime.release,
  endpoint: runtime.errorReportingEndpoint,
  logger,
});

const app = (() => {
  const element = document.querySelector<HTMLDivElement>('#app');
  if (!element) {
    throw new Error('App container #app was not found.');
  }
  return element;
})();

const sessionManager = new SessionManager();
const sessionId = sessionManager.createRoomCode();
const multiplayer = createMultiplayerService(runtime.apiEndpoint ?? undefined);
void multiplayer;

logger.info('Application bootstrapped', {
  release: runtime.release,
  environment: runtime.environment,
  debugMode: runtime.debugMode,
  logLevel: getActiveLogLevel(),
  multiplayerMode: runtime.apiEndpoint ? 'cloudflare' : 'local',
  sessionId,
});

let isMuted = false;

class SoundEffects {
  private ctx: AudioContext | null = null;

  private initCtx(): void {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  playMove(): void {
    if (isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.08);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // Audio failed or blocked
    }
  }

  playClash(): void {
    if (isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(750, now);
      osc1.frequency.exponentialRampToValueAtTime(120, now + 0.28);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1150, now);
      osc2.frequency.exponentialRampToValueAtTime(160, now + 0.22);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.28);
      osc2.stop(now + 0.28);
    } catch {
      // AudioContext might not be allowed to start yet
    }
  }

  playExplosion(): void {
    if (isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      
      const now = this.ctx.currentTime;
      const bufferSize = this.ctx.sampleRate * 0.65;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noiseNode = this.ctx.createBufferSource();
      noiseNode.buffer = buffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(380, now);
      filter.frequency.exponentialRampToValueAtTime(12, now + 0.65);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

      noiseNode.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);

      noiseNode.start(now);
      noiseNode.stop(now + 0.65);
    } catch {
      // AudioContext might not be allowed to start yet
    }
  }

  playVictory(): void {
    if (isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [261.63, 329.63, 392.00, 523.25];
      
      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        
        const noteStart = now + idx * 0.08;
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.setValueAtTime(0.07, noteStart);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.25);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(noteStart);
        osc.stop(noteStart + 0.25);
      });
    } catch {
      // AudioContext might not be allowed to start yet
    }
  }

  playDefeat(): void {
    if (isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.linearRampToValueAtTime(90, now + 0.45);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.45);
    } catch {
      // AudioContext might not be allowed to start yet
    }
  }
}

const sounds = new SoundEffects();

function getBattleOutcome(
  attacker: { kind: PieceKind; owner: PlayerColor; id?: string },
  defender: { kind: PieceKind; owner: PlayerColor; id?: string }
): 'attacker' | 'defender' | 'both' {
  if (defender.kind === 'flag') return 'attacker';
  if (defender.kind === 'bomb') return attacker.kind === 'miner' ? 'attacker' : 'defender';
  if (attacker.kind === 'spy' && defender.kind === 'marshal') return 'attacker';
  
  let aRank = RANK_VALUES[attacker.kind];
  let dRank = RANK_VALUES[defender.kind];
  
  if (attacker.id && (promotionsMap[attacker.id] ?? 0) >= 3) {
    aRank += 1;
  }
  if (defender.id && (promotionsMap[defender.id] ?? 0) >= 3) {
    dRank += 1;
  }
  
  if (aRank > dRank) return 'attacker';
  if (aRank < dRank) return 'defender';
  return 'both';
}

function hasRedPieces(board: Board): boolean {
  for (const row of board) {
    for (const cell of row) {
      if (cell && cell.owner === 'red') {
        return true;
      }
    }
  }
  return false;
}

function createSetupInitialState(): GameState {
  const initial = createInitialGameState();
  const board = cloneBoard(initial.board);
  for (let r = 6; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      board[r]![c] = null;
    }
  }
  return {
    board,
    currentPlayer: 'red',
    winner: null,
    moveCount: 0,
    history: [],
  };
}

let state: GameState = loadState() ?? createSetupInitialState();
const playerColor: PlayerColor = 'red';
let setupMode: boolean = !hasRedPieces(state.board);
let activeTheme: 'classic' | 'cyber' | 'retro' = 'classic';
let selectedBenchPiece: PieceKind | null = null;
let selectedBenchIndex: number = -1;
let setupBench: PieceKind[] = [];
const undoStack: GameState[] = [];
let isAiThinking: boolean = false;

/* --- Premium Upgrades State & Helpers --- */
let aiDifficulty: 'recruit' | 'commander' = 'commander';
let turnTimer: number = 45;
const isTimerEnabled: boolean = true;
let lastAppliedMove: Move | null = null;
let playerAvatar: string = localStorage.getItem('stratego_avatar') || '🎖️';

/* --- Batch 2 Premium Upgrades State --- */
let hardcoreFogOfWar: boolean = localStorage.getItem('stratego_hardcore_fog') === 'true';
let activeLakeLayout: 'classic' | 'island' | 'river' = 'classic';
let aiPersonality: 'balanced' | 'rusher' | 'turtler' = 'balanced';
let isHeroAbilityUsed: boolean = false;
let promotionsMap: Record<string, number> = {};
const battleLocations: Record<string, number> = JSON.parse(localStorage.getItem('stratego_heatmap') || '{}');
let isHeatmapEnabled: boolean = false;

function recordBattleClash(row: number, col: number): void {
  const key = `${row},${col}`;
  battleLocations[key] = (battleLocations[key] || 0) + 1;
  localStorage.setItem('stratego_heatmap', JSON.stringify(battleLocations));
}


let wins: number = Number(localStorage.getItem('stratego_wins') || '0');
let losses: number = Number(localStorage.getItem('stratego_losses') || '0');
let battlesCount: number = Number(localStorage.getItem('stratego_battles') || '0');
let bombsDefused: number = Number(localStorage.getItem('stratego_bombs') || '0');

function recordWin(): void {
  wins++;
  battlesCount++;
  localStorage.setItem('stratego_wins', wins.toString());
  localStorage.setItem('stratego_battles', battlesCount.toString());
}

function recordLoss(): void {
  losses++;
  battlesCount++;
  localStorage.setItem('stratego_losses', losses.toString());
  localStorage.setItem('stratego_battles', battlesCount.toString());
}

function recordDefuse(): void {
  bombsDefused++;
  localStorage.setItem('stratego_bombs', bombsDefused.toString());
}

const SETUP_PRESETS: Record<'shield' | 'blitz' | 'balanced', PieceKind[]> = {
  shield: [
    'scout', 'scout', 'sergeant', 'captain', 'scout', 'lieutenant', 'sergeant', 'captain', 'scout', 'scout',
    'miner', 'miner', 'general', 'colonel', 'major', 'marshal', 'colonel', 'major', 'miner', 'miner',
    'bomb', 'lieutenant', 'sergeant', 'captain', 'bomb', 'lieutenant', 'sergeant', 'captain', 'bomb', 'miner',
    'flag', 'bomb', 'bomb', 'spy', 'bomb', 'major', 'scout', 'scout', 'scout', 'scout'
  ],
  blitz: [
    'scout', 'scout', 'scout', 'scout', 'scout', 'scout', 'scout', 'scout', 'captain', 'captain',
    'marshal', 'general', 'spy', 'miner', 'miner', 'miner', 'miner', 'miner', 'lieutenant', 'lieutenant',
    'colonel', 'colonel', 'major', 'major', 'major', 'captain', 'captain', 'sergeant', 'sergeant', 'sergeant',
    'flag', 'bomb', 'bomb', 'bomb', 'bomb', 'bomb', 'bomb', 'sergeant', 'lieutenant', 'lieutenant'
  ],
  balanced: [
    'miner', 'scout', 'captain', 'sergeant', 'scout', 'lieutenant', 'scout', 'captain', 'scout', 'miner',
    'major', 'colonel', 'general', 'bomb', 'bomb', 'marshal', 'colonel', 'major', 'major', 'miner',
    'scout', 'captain', 'sergeant', 'lieutenant', 'bomb', 'bomb', 'lieutenant', 'sergeant', 'captain', 'miner',
    'flag', 'bomb', 'bomb', 'spy', 'scout', 'scout', 'scout', 'miner', 'sergeant', 'lieutenant'
  ]
};

function applySetupPreset(presetKey: 'shield' | 'blitz' | 'balanced'): void {
  const board = cloneBoard(state.board);
  for (let r = 6; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      board[r]![c] = null;
    }
  }
  
  state = { ...state, board };
  initializeSetupBench();
  
  const preset = SETUP_PRESETS[presetKey];
  let idx = 0;
  for (let r = 6; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const kind = preset[idx++];
      if (kind) {
        board[r]![c] = {
          id: `red-${kind}-${Date.now()}-${r}-${c}`,
          kind,
          owner: 'red',
          revealed: false
        };
      }
    }
  }
  
  setupBench = [];
  selectedBenchPiece = null;
  selectedBenchIndex = -1;
  
  state = { ...state, board };
  persistState();
  safeRender();
  sounds.playVictory();
}

function loadPuzzleScenario(puzIdx: number): void {
  setupMode = false;
  activeBattle = null;
  selected = null;
  legalMoves = new Set();
  turnTimer = 45;
  lastAppliedMove = null;
  promotionsMap = {};
  isHeroAbilityUsed = false;
  
  // Set Classic lakes for puzzles standard
  activeLakeLayout = 'classic';
  setLakeLayout('classic');
  
  const board = createEmptyBoard();
  if (puzIdx === 1) {
    // Spy Backstab Puzzle
    board[6]![4] = { id: 'red-spy-p', owner: 'red', kind: 'spy', revealed: true };
    board[5]![4] = { id: 'blue-marshal-p', owner: 'blue', kind: 'marshal', revealed: false };
    state = {
      board,
      currentPlayer: 'red',
      winner: null,
      moveCount: 0,
      history: ['🎯 PUZZLE 1: Attacking Marshal with Spy! (Tap Spy, attack Marshal!)']
    };
  } else if (puzIdx === 2) {
    // Scout Blitz & Bomb Defusal Puzzle
    board[8]![1] = { id: 'red-scout-p', owner: 'red', kind: 'scout', revealed: true };
    board[8]![2] = { id: 'red-miner-p', owner: 'red', kind: 'miner', revealed: true };
    board[5]![1] = { id: 'blue-bomb-p', owner: 'blue', kind: 'bomb', revealed: false };
    board[4]![1] = { id: 'blue-flag-p', owner: 'blue', kind: 'flag', revealed: false };
    state = {
      board,
      currentPlayer: 'red',
      winner: null,
      moveCount: 0,
      history: [
        '🎯 PUZZLE 2: Defuse the Bomb with Miner first, then slide Scout to capture the Flag!'
      ]
    };
  }
  
  persistState();
  safeRender();
  sounds.playVictory();
}


let timerInterval: number | null = null;

function startTurnTimer(): void {
  if (timerInterval) {
    window.clearInterval(timerInterval);
  }
  
  turnTimer = 45;
  
  timerInterval = window.setInterval(() => {
    if (!isTimerEnabled || setupMode || state.winner || isAiThinking) {
      return;
    }
    
    turnTimer--;
    
    const progress = document.querySelector<HTMLElement>('.timer-progress');
    if (progress) {
      const pct = (turnTimer / 45) * 100;
      progress.style.width = `${pct}%`;
      if (turnTimer <= 10) {
        progress.classList.add('timer-progress--low');
      } else {
        progress.classList.remove('timer-progress--low');
      }
    }
    
    const clockText = document.querySelector<HTMLElement>('.timer-text');
    if (clockText) {
      clockText.textContent = `⏱️ ${turnTimer}s`;
    }
    
    if (turnTimer <= 0) {
      logger.info('Turn timer expired! Switching turn.');
      turnTimer = 45;
      if (state.currentPlayer === 'red') {
        state = {
          ...state,
          currentPlayer: 'blue',
          moveCount: state.moveCount + 1
        };
        selected = null;
        legalMoves = new Set();
        persistState();
        safeRender();
        
        if (aiEnabled) {
          isAiThinking = true;
          safeRender();
          window.setTimeout(() => {
            runAiTurn();
            isAiThinking = false;
            safeRender();
          }, 1200);
        }
      } else {
        state = {
          ...state,
          currentPlayer: 'red',
          moveCount: state.moveCount + 1
        };
        selected = null;
        legalMoves = new Set();
        persistState();
        safeRender();
      }
    }
  }, 1000);
}


function initializeSetupBench(): void {
  const countsOnBoard: Record<PieceKind, number> = {
    flag: 0, bomb: 0, marshal: 0, general: 0, colonel: 0,
    major: 0, captain: 0, lieutenant: 0, sergeant: 0,
    miner: 0, scout: 0, spy: 0
  };
  
  for (const row of state.board) {
    for (const cell of row) {
      if (cell && cell.owner === 'red') {
        countsOnBoard[cell.kind]++;
      }
    }
  }
  
  setupBench = [];
  for (const [kind, total] of Object.entries(PIECE_COUNTS) as Array<[PieceKind, number]>) {
    const placed = countsOnBoard[kind] ?? 0;
    const remaining = total - placed;
    for (let i = 0; i < remaining; i++) {
      setupBench.push(kind);
    }
  }
}

if (setupMode) {
  initializeSetupBench();
}

interface BattleReportState {
  attacker: { kind: PieceKind; owner: PlayerColor };
  defender: { kind: PieceKind; owner: PlayerColor };
  resultText: string;
  position: Position;
}
let activeBattle: BattleReportState | null = null;
let selected: Position | null = null;
let legalMoves = new Set<string>();
let aiEnabled = true;
let playerName = sanitizePlayerName('Commander');
let latestLog: LogEvent | null = null;

subscribeToLogs((event) => {
  latestLog = event;
});

registerServiceWorker();
startTurnTimer();
safeRender();

function loadState(): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      logger.info('No saved game found; starting fresh game state.');
      return null;
    }

    const parsed = deserializeState(raw);
    if (!parsed) {
      logger.warn('Saved game exists but could not be deserialized.');
      return null;
    }

    const validation = validateGameState(parsed);
    if (!validation.valid) {
      logger.warn('Saved game failed validation and was ignored.', {
        reason: validation.reason,
      });
      return null;
    }

    logger.info('Saved game restored successfully.', {
      moveCount: parsed.moveCount,
      currentPlayer: parsed.currentPlayer,
    });

    return parsed;
  } catch (error) {
    logger.error('Failed to load saved game state.', {
      reason: normalizeErrorMessage(error),
    });
    return null;
  }
}

function persistState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState(state));
  } catch (error) {
    logger.error('Failed to persist game state.', {
      reason: normalizeErrorMessage(error),
    });
  }
}

function registerServiceWorker(): void {
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      logger.warn('Service worker registration failed.', {
        reason: normalizeErrorMessage(error),
      });
    });
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

function pieceLabel(kind: PieceKind): string {
  const labels: Record<PieceKind, string> = {
    flag: 'F',
    bomb: 'B',
    marshal: '10',
    general: '9',
    colonel: '8',
    major: '7',
    captain: '6',
    lieutenant: '5',
    sergeant: '4',
    miner: '3',
    scout: '2',
    spy: 'S',
  };
  return labels[kind];
}



function resolveBattleResultText(
  attacker: { kind: PieceKind; owner: PlayerColor },
  defender: { kind: PieceKind; owner: PlayerColor }
): string {
  if (defender.kind === 'flag') {
    return `🏆 ${attacker.owner.toUpperCase()} ${attacker.kind.toUpperCase()} captured the FLAG and won the game!`;
  }
  
  if (defender.kind === 'bomb') {
    return attacker.kind === 'miner'
      ? `💥 ${attacker.owner.toUpperCase()} MINER defused the BOMB!`
      : `💥 ${attacker.owner.toUpperCase()} ${attacker.kind.toUpperCase()} was blown up by BOMB!`;
  }
  
  if (attacker.kind === 'spy' && defender.kind === 'marshal') {
    return `🗡️ ${attacker.owner.toUpperCase()} SPY backstabbed the MARSHAL!`;
  }
  
  const attackerRank = RANK_VALUES[attacker.kind];
  const defenderRank = RANK_VALUES[defender.kind];
  
  if (attackerRank > defenderRank) {
    return `⚔️ ${attacker.owner.toUpperCase()} ${attacker.kind.toUpperCase()} (rank ${attackerRank}) captured ${defender.owner.toUpperCase()} ${defender.kind.toUpperCase()} (rank ${defenderRank})!`;
  }
  
  if (attackerRank < defenderRank) {
    return `⚔️ ${attacker.owner.toUpperCase()} ${attacker.kind.toUpperCase()} (rank ${attackerRank}) was defeated by ${defender.owner.toUpperCase()} ${defender.kind.toUpperCase()} (rank ${defenderRank})!`;
  }
  
  return `⚔️ Both ${attacker.kind.toUpperCase()} and ${defender.kind.toUpperCase()} (rank ${attackerRank}) eliminated each other!`;
}

function renderBattleReport(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'panel';
  container.style.background = 'linear-gradient(135deg, #1e293b, #0f172a)';
  container.style.border = '2px solid #f59e0b';
  container.style.borderRadius = '14px';
  container.style.padding = '1rem';
  container.style.color = '#f8fafc';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.gap = '0.85rem';
  container.style.boxShadow = '0 12px 28px rgba(15, 23, 42, 0.4)';
  
  const title = document.createElement('h3');
  title.textContent = '⚔️ BATTLE ENCOUNTER ⚔️';
  title.style.margin = '0';
  title.style.fontSize = '1.05rem';
  title.style.fontWeight = '800';
  title.style.letterSpacing = '0.12em';
  title.style.color = '#f59e0b';
  
  const combatants = document.createElement('div');
  combatants.style.display = 'flex';
  combatants.style.alignItems = 'center';
  combatants.style.justifyContent = 'center';
  combatants.style.gap = '1.5rem';
  combatants.style.width = '100%';
  
  const attCard = createBattlePieceCard(activeBattle!.attacker, 'ATTACKER');
  
  const vs = document.createElement('span');
  vs.textContent = 'VS';
  vs.style.fontWeight = '900';
  vs.style.fontSize = '1.35rem';
  vs.style.color = '#f59e0b';
  
  const defCard = createBattlePieceCard(activeBattle!.defender, 'DEFENDER');
  
  combatants.append(attCard, vs, defCard);
  
  const resultText = document.createElement('p');
  resultText.textContent = activeBattle!.resultText;
  resultText.style.margin = '0';
  resultText.style.fontWeight = '700';
  resultText.style.fontSize = '0.95rem';
  resultText.style.textAlign = 'center';
  resultText.style.color = '#e2e8f0';
  
  const dismissBtn = createButton('Dismiss', () => {
    activeBattle = null;
    safeRender();
  });
  dismissBtn.style.padding = '0.38rem 1.2rem';
  dismissBtn.style.background = '#334155';
  dismissBtn.style.color = '#f8fafc';
  dismissBtn.style.border = '1px solid #475569';
  dismissBtn.style.borderRadius = '8px';
  dismissBtn.style.fontSize = '0.82rem';
  dismissBtn.style.fontWeight = 'bold';
  dismissBtn.style.cursor = 'pointer';
  
  container.append(title, combatants, resultText, dismissBtn);
  return container;
}

function createBattlePieceCard(piece: { kind: PieceKind; owner: PlayerColor }, role: string): HTMLElement {
  const card = document.createElement('div');
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.alignItems = 'center';
  card.style.padding = '0.7rem 1.1rem';
  card.style.borderRadius = '10px';
  card.style.minWidth = '100px';
  card.style.border = '2px solid';
  card.style.lineHeight = '1.25';
  
  if (piece.owner === 'red') {
    card.style.background = '#7f1d1d';
    card.style.borderColor = '#b91c1c';
    card.style.color = '#fee2e2';
  } else {
    card.style.background = '#1e3a8a';
    card.style.borderColor = '#1d4ed8';
    card.style.color = '#dbeafe';
  }
  
  const roleLabel = document.createElement('span');
  roleLabel.textContent = role;
  roleLabel.style.fontSize = '0.55rem';
  roleLabel.style.opacity = '0.6';
  roleLabel.style.fontWeight = 'bold';
  roleLabel.style.letterSpacing = '0.05em';
  
  const symbol = document.createElement('span');
  symbol.textContent = PIECE_SYMBOLS[piece.kind];
  symbol.style.fontSize = '1.6rem';
  symbol.style.margin = '0.25rem 0';
  
  const rank = document.createElement('span');
  rank.textContent = pieceLabel(piece.kind);
  rank.style.fontWeight = '900';
  rank.style.fontSize = '1.15rem';
  
  const name = document.createElement('span');
  name.textContent = piece.kind.toUpperCase();
  name.style.fontSize = '0.62rem';
  name.style.fontWeight = 'bold';
  name.style.opacity = '0.8';
  name.style.letterSpacing = '0.02em';
  
  card.append(roleLabel, symbol, rank, name);
  return card;
}

function safeRender(): void {
  try {
    render();
  } catch (error) {
    const reason = normalizeErrorMessage(error);
    captureException(
      error,
      {
        phase: 'render',
        moveCount: state.moveCount,
      },
      runtime.release,
      runtime.errorReportingEndpoint,
    );
    renderFatal(reason);
  }
}

function renderFatal(reason: string): void {
  app.innerHTML = '';

  const container = document.createElement('main');
  container.className = 'app-shell';

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.style.padding = '1rem';

  const title = document.createElement('h1');
  title.textContent = 'Stratego encountered an error';
  title.style.marginTop = '0';

  const message = document.createElement('p');
  message.textContent = `Reason: ${reason}`;

  const resetButton = createButton('Reset Saved State', () => {
    localStorage.removeItem(STORAGE_KEY);
    state = createInitialGameState();
    selected = null;
    legalMoves = new Set();
    safeRender();
  });

  panel.append(title, message, resetButton);
  container.appendChild(panel);
  app.appendChild(container);
}

function statusBadge(text: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = text;
  return badge;
}

function renderHeader(): HTMLElement {
  const header = document.createElement('header');
  header.className = 'panel';
  header.style.padding = '1rem';
  header.style.marginBottom = '1rem';
  header.style.display = 'flex';
  header.style.flexWrap = 'wrap';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.gap = '0.75rem';

  const left = document.createElement('div');

  const title = document.createElement('h1');
  title.textContent = 'Stratego';
  title.style.margin = '0';
  title.style.fontSize = '1.65rem';

  const subtitle = document.createElement('p');
  subtitle.textContent = 'Offline-first strategy with production diagnostics';
  subtitle.style.margin = '0.25rem 0 0';
  subtitle.style.color = '#475569';

  left.append(title, subtitle);

  const right = document.createElement('div');
  right.style.display = 'flex';
  right.style.flexWrap = 'wrap';
  right.style.alignItems = 'center';
  right.style.gap = '0.55rem';

  const avatarContainer = document.createElement('div');
  avatarContainer.style.display = 'flex';
  avatarContainer.style.alignItems = 'center';
  avatarContainer.style.gap = '5px';
  
  const avatarsList = ['🎖️', '🕵️', '⛏️', '👑'];
  avatarsList.forEach(av => {
    const badge = document.createElement('span');
    badge.className = `avatar-badge ${playerAvatar === av ? 'avatar-badge--active' : ''}`;
    badge.textContent = av;
    badge.title = 'Select custom Commander crest';
    badge.addEventListener('click', () => {
      playerAvatar = av;
      localStorage.setItem('stratego_avatar', av);
      safeRender();
    });
    avatarContainer.appendChild(badge);
  });

  const volumeBtn = document.createElement('button');
  volumeBtn.type = 'button';
  volumeBtn.textContent = isMuted ? '🔇 Muted' : '🔊 Sound';
  volumeBtn.style.padding = '0.35rem 0.65rem';
  volumeBtn.style.fontSize = '0.78rem';
  volumeBtn.style.borderRadius = '999px';
  volumeBtn.style.border = '1px solid #cbd5e1';
  volumeBtn.style.background = '#ffffff';
  volumeBtn.style.cursor = 'pointer';
  volumeBtn.style.fontWeight = 'bold';
  volumeBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    logger.info('Volume toggled.', { isMuted });
    safeRender();
  });

  const timerBadge = statusBadge(`⏱️ ${turnTimer}s`);
  timerBadge.className = 'badge timer-text';

  right.append(
    avatarContainer,
    volumeBtn,
    statusBadge(setupMode ? 'Status: SETUP' : `Turn: ${state.currentPlayer.toUpperCase()}`),
    timerBadge,
    statusBadge(`Moves: ${state.moveCount}`),
    statusBadge(`${playerAvatar} ${playerName}`),
  );

  if (runtime.debugMode) {
    right.append(statusBadge(`Log: ${getActiveLogLevel().toUpperCase()}`));
  }

  header.append(left, right);

  const timerBarContainer = document.createElement('div');
  timerBarContainer.className = 'timer-container';
  
  const timerProgressBar = document.createElement('div');
  timerProgressBar.className = 'timer-progress';
  const pct = (turnTimer / 45) * 100;
  timerProgressBar.style.width = `${pct}%`;
  if (turnTimer <= 10) {
    timerProgressBar.classList.add('timer-progress--low');
  }
  
  timerBarContainer.appendChild(timerProgressBar);

  const headerWrapper = document.createElement('div');
  headerWrapper.style.width = '100%';
  headerWrapper.style.display = 'flex';
  headerWrapper.style.flexDirection = 'column';
  headerWrapper.appendChild(header);
  
  if (!setupMode && !state.winner) {
    headerWrapper.appendChild(timerBarContainer);
  }

  return headerWrapper;
}

function render(): void {
  if (forceRenderCrash) {
    throw new Error('Forced render crash via query parameter.');
  }

  app.innerHTML = '';

  const shell = document.createElement('main');
  shell.className = `app-shell theme-${activeTheme}`;

  shell.appendChild(renderHeader());

  const content = document.createElement('section');
  content.className = 'content-grid';

  const boardPanel = document.createElement('article');
  boardPanel.className = 'panel';
  boardPanel.style.padding = '1rem';
  boardPanel.style.display = 'flex';
  boardPanel.style.flexDirection = 'column';
  boardPanel.style.gap = '1.25rem';
  boardPanel.style.alignItems = 'center';

  if (activeBattle) {
    boardPanel.appendChild(renderBattleReport());
  }

  boardPanel.appendChild(renderBoard());

  const sidebar = document.createElement('aside');
  sidebar.className = 'panel';
  sidebar.style.padding = '1rem';
  sidebar.appendChild(renderSidebar());

  content.append(boardPanel, sidebar);
  shell.appendChild(content);

  app.appendChild(shell);

  if (state.winner) {
    app.appendChild(renderGameOverModal());
  }
}

function generateRecapSVG(): string {
  const isVictory = state.winner === 'red';
  const bannerText = isVictory ? 'VICTORY' : 'DEFEAT';
  const bannerColor = isVictory ? '#10b981' : '#ef4444';
  const avatar = playerAvatar || '🎖️';
  const name = playerName || 'Commander';
  
  const captures = getCapturedPieces(state.board);
  const redLost = Object.values(captures.blue).reduce((a, b) => a + b, 0);
  const blueCaptured = Object.values(captures.red).reduce((a, b) => a + b, 0);
  
  // Clean name for SVG to prevent breakage
  const escapedName = name.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" width="100%" height="100%" style="background:#0f172a; font-family:'Segoe UI',Roboto,Helvetica,sans-serif; border-radius:16px; overflow:hidden;">
    <defs>
      <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1e293b"/>
        <stop offset="100%" stop-color="#0f172a"/>
      </linearGradient>
      <linearGradient id="header-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${bannerColor}"/>
        <stop offset="100%" stop-color="#1e1b4b"/>
      </linearGradient>
    </defs>
    
    <rect width="100%" height="100%" fill="url(#bg-grad)"/>
    
    <!-- Outer Gold/Silver Border -->
    <rect x="15" y="15" width="470" height="470" fill="none" stroke="${isVictory ? '#f59e0b' : '#94a3b8'}" stroke-width="4" rx="12" opacity="0.8"/>
    
    <!-- Header Banner -->
    <rect x="0" y="0" width="500" height="90" fill="url(#header-grad)"/>
    <text x="250" y="55" font-size="32" font-weight="900" fill="#ffffff" text-anchor="middle" letter-spacing="4">${bannerText}</text>
    
    <!-- Commander Profile -->
    <circle cx="250" cy="160" r="45" fill="#1e293b" stroke="${isVictory ? '#fbbf24' : '#cbd5e1'}" stroke-width="3"/>
    <text x="250" y="178" font-size="48" text-anchor="middle">${avatar}</text>
    <text x="250" y="230" font-size="20" font-weight="bold" fill="#f8fafc" text-anchor="middle">${escapedName}</text>
    <text x="250" y="250" font-size="12" fill="#64748b" text-anchor="middle">STRATEGO TACTICAL DIVISION</text>
    
    <!-- Stats Grid Box -->
    <rect x="40" y="280" width="420" height="150" fill="#1e293b" rx="8" stroke="#334155" stroke-width="1"/>
    
    <!-- Column 1: Current Match Stats -->
    <text x="135" y="312" font-size="13" font-weight="bold" fill="${isVictory ? '#34d399' : '#f87171'}" text-anchor="middle">CURRENT MATCH</text>
    <line x1="60" y1="322" x2="210" y2="322" stroke="#475569" stroke-width="1"/>
    
    <text x="60" y="348" font-size="12" fill="#94a3b8">Moves Taken:</text>
    <text x="210" y="348" font-size="13" font-weight="bold" fill="#f1f5f9" text-anchor="end">${state.moveCount}</text>
    
    <text x="60" y="378" font-size="12" fill="#94a3b8">Captured Enemy:</text>
    <text x="210" y="378" font-size="13" font-weight="bold" fill="#f1f5f9" text-anchor="end">${blueCaptured} / 40</text>
    
    <text x="60" y="408" font-size="12" fill="#94a3b8">Units Lost:</text>
    <text x="210" y="408" font-size="13" font-weight="bold" fill="#f87171" text-anchor="end">${redLost} / 40</text>
    
    <!-- Vertical Divider -->
    <line x1="250" y1="295" x2="250" y2="415" stroke="#334155" stroke-width="2" stroke-dasharray="4"/>
    
    <!-- Column 2: Lifetime Career Stats -->
    <text x="365" y="312" font-size="13" font-weight="bold" fill="#fbbf24" text-anchor="middle">LIFETIME RECORD</text>
    <line x1="290" y1="322" x2="440" y2="322" stroke="#475569" stroke-width="1"/>
    
    <text x="290" y="348" font-size="12" fill="#94a3b8">Career Wins:</text>
    <text x="440" y="348" font-size="13" font-weight="bold" fill="#f1f5f9" text-anchor="end">${wins}</text>
    
    <text x="290" y="378" font-size="12" fill="#94a3b8">Career Losses:</text>
    <text x="440" y="378" font-size="13" font-weight="bold" fill="#f1f5f9" text-anchor="end">${losses}</text>
    
    <text x="290" y="408" font-size="12" fill="#94a3b8">Bombs Defused:</text>
    <text x="440" y="408" font-size="13" font-weight="bold" fill="#f1f5f9" text-anchor="end">${bombsDefused}</text>
    
    <!-- Footer -->
    <text x="250" y="465" font-size="11" fill="#475569" text-anchor="middle" letter-spacing="1">GENERATED SECURELY BY ANTIGRAVITY OS</text>
  </svg>`;
}

function renderGameOverModal(): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  const content = document.createElement('div');
  content.className = 'modal-content';
  content.style.maxHeight = '95vh';
  content.style.overflowY = 'auto';
  
  const title = document.createElement('h2');
  title.style.margin = '0';
  title.style.textAlign = 'center';
  title.style.fontSize = '1.8rem';
  
  if (state.winner === 'red') {
    title.textContent = '🏆 VICTORY!';
    title.style.color = '#10b981';
  } else {
    title.textContent = '💀 DEFEAT';
    title.style.color = '#ef4444';
  }
  
  const desc = document.createElement('p');
  desc.textContent = state.winner === 'red'
    ? 'Congratulations, Commander! You have successfully captured the enemy Flag and won the war!'
    : 'Your Flag has been captured by the enemy. Strategic retreat ordered.';
  desc.style.textAlign = 'center';
  desc.style.margin = '0';
  desc.style.lineHeight = '1.4';
  
  const statsPanel = document.createElement('div');
  statsPanel.style.display = 'grid';
  statsPanel.style.gridTemplateColumns = '1fr 1fr';
  statsPanel.style.gap = '0.5rem';
  statsPanel.style.padding = '1rem';
  statsPanel.style.background = 'rgba(0, 0, 0, 0.05)';
  statsPanel.style.borderRadius = '10px';
  statsPanel.style.fontSize = '0.9rem';
  
  const movesLabel = document.createElement('strong');
  movesLabel.textContent = 'Total Moves:';
  const movesVal = document.createElement('span');
  movesVal.textContent = state.moveCount.toString();
  
  const captures = getCapturedPieces(state.board);
  const redLost = Object.values(captures.blue).reduce((a, b) => a + b, 0);
  const blueCaptured = Object.values(captures.red).reduce((a, b) => a + b, 0);
  
  const lostLabel = document.createElement('strong');
  lostLabel.textContent = 'Your Units Lost:';
  const lostVal = document.createElement('span');
  lostVal.textContent = `${redLost} / 40`;
  
  const capLabel = document.createElement('strong');
  capLabel.textContent = 'Enemy Units Captured:';
  const capVal = document.createElement('span');
  capVal.textContent = `${blueCaptured} / 40`;
  
  statsPanel.append(movesLabel, movesVal, lostLabel, lostVal, capLabel, capVal);
  
  // Render visual SVG recap card container
  const cardContainer = document.createElement('div');
  cardContainer.style.width = '100%';
  cardContainer.style.maxWidth = '320px';
  cardContainer.style.margin = '1rem auto';
  cardContainer.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3)';
  cardContainer.style.borderRadius = '16px';
  cardContainer.style.overflow = 'hidden';
  cardContainer.style.aspectRatio = '1/1';
  cardContainer.style.display = 'flex';
  
  const svgString = generateRecapSVG();
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const cardImg = document.createElement('img');
  cardImg.src = url;
  cardImg.alt = 'Tactical Recap Card';
  cardImg.style.width = '100%';
  cardImg.style.height = '100%';
  cardImg.style.display = 'block';
  cardContainer.appendChild(cardImg);
  
  // Action Buttons
  const buttonRow = document.createElement('div');
  buttonRow.style.display = 'grid';
  buttonRow.style.gridTemplateColumns = '1fr 1fr';
  buttonRow.style.gap = '0.5rem';
  buttonRow.style.marginTop = '1rem';
  buttonRow.style.width = '100%';
  
  const playAgainBtn = createButton('Play Again', () => {
    logger.info('Restarting game from Game Over modal.');
    state = createSetupInitialState();
    setupMode = true;
    selected = null;
    legalMoves = new Set();
    activeBattle = null;
    isHeroAbilityUsed = false; // Reset Hero ability
    initializeSetupBench();
    persistState();
    safeRender();
  });
  playAgainBtn.style.padding = '0.7rem';
  playAgainBtn.style.background = state.winner === 'red' ? '#16a34a' : '#ef4444';
  playAgainBtn.style.color = '#ffffff';
  playAgainBtn.style.border = 'none';
  playAgainBtn.style.fontSize = '1rem';
  playAgainBtn.style.fontWeight = 'bold';
  playAgainBtn.style.borderRadius = '10px';
  playAgainBtn.style.cursor = 'pointer';
  
  const downloadBtn = document.createElement('a');
  downloadBtn.textContent = '💾 Download Card';
  downloadBtn.href = url;
  downloadBtn.download = `Stratego_Recap_${state.winner === 'red' ? 'Victory' : 'Defeat'}_${Date.now()}.svg`;
  downloadBtn.style.display = 'flex';
  downloadBtn.style.alignItems = 'center';
  downloadBtn.style.justifyContent = 'center';
  downloadBtn.style.padding = '0.7rem';
  downloadBtn.style.background = '#3b82f6';
  downloadBtn.style.color = '#ffffff';
  downloadBtn.style.fontSize = '1rem';
  downloadBtn.style.fontWeight = 'bold';
  downloadBtn.style.borderRadius = '10px';
  downloadBtn.style.cursor = 'pointer';
  downloadBtn.style.textDecoration = 'none';
  downloadBtn.style.border = 'none';
  
  buttonRow.append(playAgainBtn, downloadBtn);
  
  content.append(title, desc, statsPanel, cardContainer, buttonRow);
  overlay.appendChild(content);
  return overlay;
}

function getCapturedPieces(board: Board): { red: Record<PieceKind, number>; blue: Record<PieceKind, number> } {
  const counts = countPiecesByOwner(board);
  const red: Record<PieceKind, number> = {
    flag: 0, bomb: 0, marshal: 0, general: 0, colonel: 0, major: 0,
    captain: 0, lieutenant: 0, sergeant: 0, miner: 0, scout: 0, spy: 0
  };
  const blue: Record<PieceKind, number> = {
    flag: 0, bomb: 0, marshal: 0, general: 0, colonel: 0, major: 0,
    captain: 0, lieutenant: 0, sergeant: 0, miner: 0, scout: 0, spy: 0
  };
  
  for (const [kind, total] of Object.entries(PIECE_COUNTS) as Array<[PieceKind, number]>) {
    red[kind] = total - (counts.red[kind] ?? 0);
    blue[kind] = total - (counts.blue[kind] ?? 0);
  }
  
  return { red, blue };
}

function renderGraveyard(): HTMLElement {
  const container = document.createElement('section');
  container.style.display = 'grid';
  container.style.gap = '0.5rem';
  container.style.paddingTop = '0.5rem';
  container.style.borderTop = '1px solid #cbd5e1';
  
  const title = document.createElement('h3');
  title.textContent = '⛨ Captured Units (Graveyard)';
  title.style.margin = '0';
  title.style.fontSize = '0.92rem';
  
  const captures = getCapturedPieces(state.board);
  
  const redGrave = document.createElement('div');
  redGrave.style.display = 'flex';
  redGrave.style.flexWrap = 'wrap';
  redGrave.style.gap = '4px';
  redGrave.style.padding = '0.4rem';
  redGrave.style.background = 'rgba(185, 28, 28, 0.05)';
  redGrave.style.borderRadius = '8px';
  redGrave.style.minHeight = '32px';
  
  const redTitle = document.createElement('span');
  redTitle.textContent = '🔴 Captured from Red: ';
  redTitle.style.fontSize = '0.74rem';
  redTitle.style.fontWeight = 'bold';
  redTitle.style.width = '100%';
  redGrave.appendChild(redTitle);

  let redAny = false;
  for (const [kind, count] of Object.entries(captures.blue) as Array<[PieceKind, number]>) {
    if (count > 0) {
      redAny = true;
      const chip = document.createElement('span');
      chip.className = 'badge';
      chip.textContent = `${PIECE_SYMBOLS[kind]} ${pieceLabel(kind)} x${count}`;
      chip.style.fontSize = '0.72rem';
      chip.style.padding = '0.1rem 0.35rem';
      redGrave.appendChild(chip);
    }
  }
  if (!redAny) {
    const emptyText = document.createElement('span');
    emptyText.textContent = 'None';
    emptyText.style.fontSize = '0.72rem';
    emptyText.style.opacity = '0.6';
    redGrave.appendChild(emptyText);
  }

  const blueGrave = document.createElement('div');
  blueGrave.style.display = 'flex';
  blueGrave.style.flexWrap = 'wrap';
  blueGrave.style.gap = '4px';
  blueGrave.style.padding = '0.4rem';
  blueGrave.style.background = 'rgba(29, 78, 216, 0.05)';
  blueGrave.style.borderRadius = '8px';
  blueGrave.style.minHeight = '32px';
  
  const blueTitle = document.createElement('span');
  blueTitle.textContent = '🔵 Captured from Blue: ';
  blueTitle.style.fontSize = '0.74rem';
  blueTitle.style.fontWeight = 'bold';
  blueTitle.style.width = '100%';
  blueGrave.appendChild(blueTitle);

  let blueAny = false;
  for (const [kind, count] of Object.entries(captures.red) as Array<[PieceKind, number]>) {
    if (count > 0) {
      blueAny = true;
      const chip = document.createElement('span');
      chip.className = 'badge';
      chip.textContent = `${PIECE_SYMBOLS[kind]} ${pieceLabel(kind)} x${count}`;
      chip.style.fontSize = '0.72rem';
      chip.style.padding = '0.1rem 0.35rem';
      blueGrave.appendChild(chip);
    }
  }
  if (!blueAny) {
    const emptyText = document.createElement('span');
    emptyText.textContent = 'None';
    emptyText.style.fontSize = '0.72rem';
    emptyText.style.opacity = '0.6';
    blueGrave.appendChild(emptyText);
  }
  
  container.append(title, redGrave, blueGrave);
  return container;
}

function renderTrophyCabinet(): HTMLElement {
  const container = document.createElement('section');
  container.style.display = 'grid';
  container.style.gap = '0.5rem';
  container.style.paddingTop = '0.5rem';
  container.style.borderTop = '1px solid #cbd5e1';
  
  const title = document.createElement('h3');
  title.textContent = '🏆 Lifetime Trophy Cabinet';
  title.style.margin = '0';
  title.style.fontSize = '0.92rem';
  
  const grid = document.createElement('div');
  grid.className = 'trophy-grid';
  
  const stats = [
    { title: 'War Battles', val: battlesCount.toString() },
    { title: 'Triumphant Wins', val: wins.toString() },
    { title: 'Tactical Losses', val: losses.toString() },
    { title: 'Mines Defused', val: bombsDefused.toString() }
  ];
  
  stats.forEach(st => {
    const card = document.createElement('div');
    card.className = 'trophy-card';
    
    const label = document.createElement('span');
    label.className = 'trophy-title';
    label.textContent = st.title;
    
    const val = document.createElement('span');
    val.className = 'trophy-val';
    val.textContent = st.val;
    
    card.append(label, val);
    grid.appendChild(card);
  });
  
  container.append(title, grid);
  return container;
}

function renderThemeSwitcher(): HTMLElement {
  const container = document.createElement('div');
  container.style.display = 'grid';
  container.style.gap = '0.35rem';
  
  const title = document.createElement('label');
  title.textContent = '🎨 Battlefield Theme:';
  title.style.fontSize = '0.8rem';
  title.style.fontWeight = 'bold';
  
  const group = document.createElement('div');
  group.style.display = 'grid';
  group.style.gridTemplateColumns = '1fr 1fr 1fr';
  group.style.gap = '4px';
  
  const themes: Array<'classic' | 'cyber' | 'retro'> = ['classic', 'cyber', 'retro'];
  for (const t of themes) {
    const btn = createButton(t.toUpperCase(), () => {
      activeTheme = t;
      logger.info('Theme changed.', { theme: t });
      safeRender();
    });
    btn.style.padding = '0.35rem';
    btn.style.fontSize = '0.72rem';
    btn.style.borderRadius = '6px';
    if (activeTheme === t) {
      btn.style.borderColor = '#16a34a';
      btn.style.background = '#e2e8f0';
    }
    group.appendChild(btn);
  }
  
  container.append(title, group);
  return container;
}

function renderRulesCard(): HTMLElement {
  const container = document.createElement('section');
  container.style.marginTop = '0.4rem';
  container.style.borderTop = '1px solid #cbd5e1';
  container.style.paddingTop = '0.6rem';

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = '📜 Ranks & Rules Guide';
  summary.style.fontWeight = 'bold';
  summary.style.cursor = 'pointer';
  summary.style.fontSize = '0.88rem';
  
  const content = document.createElement('div');
  content.style.fontSize = '0.76rem';
  content.style.lineHeight = '1.45';
  content.style.marginTop = '0.5rem';
  content.style.display = 'grid';
  content.style.gap = '0.3rem';
  content.style.maxHeight = '15rem';
  content.style.overflowY = 'auto';
  content.style.paddingRight = '4px';

  const ruleLines = [
    '👑 10 Marshal (x1): Strongest piece. Defeated only by Spy if attacked first.',
    '⭐ 9 General (x1)',
    '🦅 8 Colonel (x2)',
    '🎖️ 7 Major (x3)',
    '⚓ 6 Captain (x4)',
    '🗡️ 5 Lieutenant (x4)',
    '🎗️ 4 Sergeant (x4)',
    '⛏️ 3 Miner (x5): Special ability to defuse Bombs without exploding.',
    '🏹 2 Scout (x8): Special ability to slide any distance orthogonally.',
    '🕵️ S Spy (x1): Weakest rank, but can defeat the Marshal if it attacks him.',
    '💣 B Bomb (x6): Immovable. Blows up any attacking unit except Miners.',
    '🚩 F Flag (x1): Immovable. Capture the enemy Flag to win the game!'
  ];

  for (const line of ruleLines) {
    const p = document.createElement('div');
    p.textContent = line;
    p.style.paddingBottom = '2px';
    content.appendChild(p);
  }

  // Interactive Combat Matchup Predictor Calculator
  const calcTitle = document.createElement('div');
  calcTitle.textContent = '🔍 Combat Matchup Predictor';
  calcTitle.style.fontWeight = 'bold';
  calcTitle.style.fontSize = '0.8rem';
  calcTitle.style.marginTop = '0.65rem';
  calcTitle.style.borderTop = '1px dashed #cbd5e1';
  calcTitle.style.paddingTop = '0.5rem';
  
  const calcRow = document.createElement('div');
  calcRow.style.display = 'flex';
  calcRow.style.gap = '4px';
  calcRow.style.alignItems = 'center';
  calcRow.style.marginTop = '4px';
  
  const selAtt = document.createElement('select');
  selAtt.style.fontSize = '0.74rem';
  selAtt.style.padding = '2px';
  
  const selDef = document.createElement('select');
  selDef.style.fontSize = '0.74rem';
  selDef.style.padding = '2px';
  
  const ranksList: PieceKind[] = [
    'marshal', 'general', 'colonel', 'major', 'captain',
    'lieutenant', 'sergeant', 'miner', 'scout', 'spy',
    'bomb', 'flag'
  ];
  
  ranksList.forEach(r => {
    const optA = document.createElement('option');
    optA.value = r;
    optA.textContent = `${PIECE_SYMBOLS[r]} ${pieceLabel(r)} ${r.toUpperCase()}`;
    selAtt.appendChild(optA);
    
    const optD = document.createElement('option');
    optD.value = r;
    optD.textContent = `${PIECE_SYMBOLS[r]} ${pieceLabel(r)} ${r.toUpperCase()}`;
    selDef.appendChild(optD);
  });
  
  const vsText = document.createElement('span');
  vsText.textContent = 'vs';
  vsText.style.fontSize = '0.74rem';
  
  const resultIndicator = document.createElement('div');
  resultIndicator.style.fontSize = '0.74rem';
  resultIndicator.style.fontWeight = 'bold';
  resultIndicator.style.color = '#16a34a';
  resultIndicator.style.marginTop = '4px';
  resultIndicator.textContent = 'Select ranks to predict combat...';
  
  const runCalc = () => {
    const attKind = selAtt.value as PieceKind;
    const defKind = selDef.value as PieceKind;
    
    if (attKind === 'flag' || attKind === 'bomb') {
      resultIndicator.textContent = '❌ Attacker cannot be Flag or Bomb!';
      resultIndicator.style.color = '#ef4444';
      return;
    }
    
    const attPiece = { owner: 'red' as PlayerColor, kind: attKind };
    const defPiece = { owner: 'blue' as PlayerColor, kind: defKind };
    
    const outcome = getBattleOutcome(attPiece, defPiece);
    if (outcome === 'attacker') {
      resultIndicator.textContent = '🏆 Attacker Wins!';
      resultIndicator.style.color = '#16a34a';
    } else if (outcome === 'defender') {
      resultIndicator.textContent = '💀 Defender Wins!';
      resultIndicator.style.color = '#ef4444';
    } else {
      resultIndicator.textContent = '💥 Both Eliminated!';
      resultIndicator.style.color = '#f59e0b';
    }
  };
  
  selAtt.addEventListener('change', runCalc);
  selDef.addEventListener('change', runCalc);
  
  calcRow.append(selAtt, vsText, selDef);
  content.append(calcTitle, calcRow, resultIndicator);

  details.append(summary, content);
  container.appendChild(details);
  return container;
}

function cloneGameState(s: GameState): GameState {
  return {
    board: cloneBoard(s.board),
    currentPlayer: s.currentPlayer,
    winner: s.winner,
    moveCount: s.moveCount,
    history: [...s.history],
  };
}

function autoFillRedArmy(): void {
  const board = cloneBoard(state.board);
  for (let r = 6; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      board[r]![c] = null;
    }
  }
  
  state = { ...state, board };
  initializeSetupBench();
  
  const pool = shuffle([...setupBench]);
  let poolIdx = 0;
  
  for (let r = 6; r < 10; r++) {
    for (let c = 0; c < 10; c++) {
      const kind = pool[poolIdx++];
      if (kind) {
        board[r]![c] = {
          id: `red-${kind}-${Date.now()}-${r}-${c}`,
          kind,
          owner: 'red',
          revealed: false
        };
      }
    }
  }
  
  setupBench = [];
  selectedBenchPiece = null;
  selectedBenchIndex = -1;
  
  state = { ...state, board };
  persistState();
  safeRender();
  sounds.playVictory();
}

function shuffle<T>(items: T[]): T[] {
  const clone = [...items];
  for (let i = clone.length - 1; i > 0; i--) {
    const swap = Math.floor(Math.random() * (i + 1));
    const temp = clone[i];
    clone[i] = clone[swap] as T;
    clone[swap] = temp as T;
  }
  return clone;
}

function renderSetupBench(): HTMLElement {
  const container = document.createElement('section');
  container.style.display = 'grid';
  container.style.gap = '0.55rem';
  
  const title = document.createElement('h2');
  title.textContent = '♟️ Setup Your Red Army';
  title.style.margin = '0';
  title.style.fontSize = '1.15rem';
  
  const desc = document.createElement('p');
  desc.textContent = 'Select a piece from the bench below, then click a highlightedstarting cell (rows 7-10) to place it. Click a placed piece to return it to the bench.';
  desc.style.margin = '0';
  desc.style.fontSize = '0.78rem';
  desc.style.opacity = '0.75';
  desc.style.lineHeight = '1.35';

  const benchHeader = document.createElement('div');
  benchHeader.style.display = 'flex';
  benchHeader.style.justifyContent = 'space-between';
  benchHeader.style.alignItems = 'center';
  
  const benchCount = document.createElement('span');
  benchCount.textContent = `Bench: ${setupBench.length} / 40`;
  benchCount.style.fontSize = '0.78rem';
  benchCount.style.fontWeight = 'bold';
  benchHeader.appendChild(benchCount);
  
  const bench = document.createElement('div');
  bench.className = 'setup-bench';
  
  const groups: Record<PieceKind, number> = {
    flag: 0, bomb: 0, marshal: 0, general: 0, colonel: 0, major: 0,
    captain: 0, lieutenant: 0, sergeant: 0, miner: 0, scout: 0, spy: 0
  };
  for (const kind of setupBench) {
    groups[kind]++;
  }

  const order: PieceKind[] = [
    'marshal', 'general', 'colonel', 'major', 'captain',
    'lieutenant', 'sergeant', 'miner', 'scout', 'spy',
    'bomb', 'flag'
  ];

  for (const kind of order) {
    const count = groups[kind];
    if (count > 0) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'bench-card';
      if (selectedBenchPiece === kind) {
        card.classList.add('bench-card--selected');
      }
      
      const symbol = document.createElement('span');
      symbol.textContent = PIECE_SYMBOLS[kind];
      symbol.style.fontSize = '1.25rem';
      
      const rank = document.createElement('span');
      rank.textContent = `${pieceLabel(kind)} (x${count})`;
      rank.style.fontSize = '0.62rem';
      rank.style.fontWeight = 'bold';
      
      card.append(symbol, rank);
      card.addEventListener('click', () => {
        selectedBenchPiece = kind;
        selectedBenchIndex = setupBench.indexOf(kind);
        safeRender();
      });
      bench.appendChild(card);
    }
  }

  if (setupBench.length === 0) {
    const emptyText = document.createElement('p');
    emptyText.textContent = '🎉 All pieces placed! Click "Start Battle" below to begin!';
    emptyText.style.margin = '0.5rem 0';
    emptyText.style.fontSize = '0.82rem';
    emptyText.style.fontWeight = 'bold';
    emptyText.style.color = '#16a34a';
    emptyText.style.textAlign = 'center';
    bench.appendChild(emptyText);
  }

  const buttons = document.createElement('div');
  buttons.style.display = 'grid';
  buttons.style.gridTemplateColumns = '1fr 1fr';
  buttons.style.gap = '0.45rem';
  
  const autofillBtn = createButton('⚡ Auto-Fill', () => {
    logger.info('Auto-filling red army.');
    autoFillRedArmy();
  });
  autofillBtn.style.padding = '0.5rem';
  autofillBtn.style.fontSize = '0.8rem';
  autofillBtn.style.fontWeight = 'bold';
  autofillBtn.style.cursor = 'pointer';

  const clearBtn = createButton('🗑️ Clear Board', () => {
    logger.info('Clearing Red starting grid.');
    const board = cloneBoard(state.board);
    for (let r = 6; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        board[r]![c] = null;
      }
    }
    state = { ...state, board };
    initializeSetupBench();
    selectedBenchPiece = null;
    selectedBenchIndex = -1;
    persistState();
    safeRender();
    sounds.playDefeat();
  });
  clearBtn.style.padding = '0.5rem';
  clearBtn.style.fontSize = '0.8rem';
  clearBtn.style.fontWeight = 'bold';
  clearBtn.style.cursor = 'pointer';
  
  buttons.append(autofillBtn, clearBtn);

  const lakeLabel = document.createElement('label');
  lakeLabel.textContent = '🗺️ Battlefield Choke Points:';
  lakeLabel.style.fontSize = '0.76rem';
  lakeLabel.style.fontWeight = 'bold';
  lakeLabel.style.marginTop = '0.1rem';
  
  const lakeGrid = document.createElement('div');
  lakeGrid.style.display = 'grid';
  lakeGrid.style.gridTemplateColumns = '1fr 1fr 1fr';
  lakeGrid.style.gap = '0.3rem';
  lakeGrid.style.marginBottom = '0.15rem';
  
  const layouts: Array<'classic' | 'island' | 'river'> = ['classic', 'island', 'river'];
  layouts.forEach(lay => {
    const btn = createButton(lay.toUpperCase(), () => {
      activeLakeLayout = lay;
      setLakeLayout(lay);
      logger.info('Lake layout changed.', { layout: lay });
      safeRender();
    });
    btn.style.padding = '0.35rem';
    btn.style.fontSize = '0.68rem';
    btn.style.borderRadius = '6px';
    if (activeLakeLayout === lay) {
      btn.style.borderColor = '#16a34a';
      btn.style.background = '#e2e8f0';
    }
    lakeGrid.appendChild(btn);
  });

  const presetContainer = document.createElement('div');
  presetContainer.style.display = 'grid';
  presetContainer.style.gridTemplateColumns = '1fr 1fr 1fr';
  presetContainer.style.gap = '0.35rem';
  presetContainer.style.marginTop = '0.1rem';
  presetContainer.style.marginBottom = '0.2rem';
  
  const shieldBtn = createButton('🛡️ Shield', () => applySetupPreset('shield'));
  shieldBtn.style.padding = '0.42rem';
  shieldBtn.style.fontSize = '0.74rem';
  shieldBtn.style.fontWeight = 'bold';
  
  const blitzBtn = createButton('🏹 Blitz', () => applySetupPreset('blitz'));
  blitzBtn.style.padding = '0.42rem';
  blitzBtn.style.fontSize = '0.74rem';
  blitzBtn.style.fontWeight = 'bold';
  
  const balanceBtn = createButton('⚖️ Patrol', () => applySetupPreset('balanced'));
  balanceBtn.style.padding = '0.42rem';
  balanceBtn.style.fontSize = '0.74rem';
  balanceBtn.style.fontWeight = 'bold';
  
  presetContainer.append(shieldBtn, blitzBtn, balanceBtn);

  const startBtn = createButton('⚔️ START BATTLE', () => {
    setupMode = false;
    selectedBenchPiece = null;
    selectedBenchIndex = -1;
    persistState();
    safeRender();
    sounds.playVictory();
  });
  startBtn.style.padding = '0.65rem';
  startBtn.style.fontSize = '0.95rem';
  startBtn.style.fontWeight = 'bold';
  startBtn.style.borderRadius = '10px';
  startBtn.style.background = '#16a34a';
  startBtn.style.color = '#ffffff';
  startBtn.style.border = 'none';
  startBtn.style.cursor = 'pointer';
  
  if (setupBench.length > 0) {
    startBtn.disabled = true;
    startBtn.style.opacity = '0.5';
    startBtn.style.cursor = 'not-allowed';
  }

  container.append(title, desc, benchHeader, bench, buttons, lakeLabel, lakeGrid, presetContainer, startBtn);
  return container;
}

function createCoordLabel(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'coord-label';
  span.textContent = text;
  return span;
}

function renderBoard(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'board-container';
  
  container.appendChild(createCoordLabel(''));
  for (let col = 0; col < 10; col++) {
    container.appendChild(createCoordLabel(String.fromCharCode(65 + col)));
  }
  container.appendChild(createCoordLabel(''));

  for (let row = 0; row < 10; row++) {
    container.appendChild(createCoordLabel((row + 1).toString()));

    for (let col = 0; col < 10; col++) {
      const position = { row, col };
      const key = positionToKey(position);
      const piece = state.board[row]?.[col] ?? null;
      const isSelected = selected ? selected.row === row && selected.col === col : false;
      const isLegal = legalMoves.has(key);

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `cell ${((row + col) % 2 === 0) ? '' : 'cell--dark'}`;
      cell.setAttribute('aria-label', `Board cell ${row}, ${col}`);

      if (isLake(position)) {
        cell.classList.add('cell--lake');
        cell.disabled = true;
        cell.textContent = 'Lake';
      } else {
        if (isSelected) {
          cell.classList.add('cell--selected');
        }
        if (isLegal) {
          cell.classList.add('cell--legal');
        }

        if (isHeatmapEnabled) {
          const clashCount = battleLocations[key] || 0;
          if (clashCount > 0) {
            const opacity = Math.min(clashCount * 0.25, 0.95);
            cell.style.boxShadow = `inset 0 0 12px rgba(220, 38, 38, ${opacity})`;
            cell.style.borderColor = `rgba(220, 38, 38, ${opacity})`;
          }
        }

        if (lastAppliedMove) {
          if (lastAppliedMove.from.row === row && lastAppliedMove.from.col === col) {
            cell.classList.add('cell--last-from');
          } else if (lastAppliedMove.to.row === row && lastAppliedMove.to.col === col) {
            cell.classList.add('cell--last-to');
          }
        }

        if (setupMode && row >= 6) {
          cell.style.border = '2px dashed #b91c1c';
          if (!piece) {
            cell.style.background = (row + col) % 2 === 0 ? '#fff5f5' : '#fee2e2';
          }
        }

        if (piece) {
          const isRevealed = piece.owner === playerColor || 
                             (!hardcoreFogOfWar && piece.revealed) || 
                             state.winner !== null;
          
          const pContainer = document.createElement('div');
          pContainer.className = 'piece-container';

          if (isRevealed) {
            const symbolSpan = document.createElement('span');
            const isPromoted = piece.id && (promotionsMap[piece.id] ?? 0) >= 3;
            symbolSpan.textContent = isPromoted ? '⭐' : PIECE_SYMBOLS[piece.kind];
            symbolSpan.className = 'piece-symbol';
            
            const rankSpan = document.createElement('span');
            rankSpan.textContent = pieceLabel(piece.kind);
            rankSpan.className = 'piece-rank';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = piece.kind.toUpperCase();
            nameSpan.className = 'piece-name';

            pContainer.append(symbolSpan, rankSpan, nameSpan);
            cell.appendChild(pContainer);
            cell.title = `${piece.owner} ${piece.kind}`;
            cell.classList.add(piece.owner === 'red' ? 'cell--piece-red' : 'cell--piece-blue');
          } else {
            const symbolSpan = document.createElement('span');
            symbolSpan.textContent = '🛡️';
            symbolSpan.className = 'piece-symbol';
            
            const rankSpan = document.createElement('span');
            rankSpan.textContent = '?';
            rankSpan.className = 'piece-rank';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = 'UNKNOWN';
            nameSpan.className = 'piece-name';

            pContainer.append(symbolSpan, rankSpan, nameSpan);
            cell.appendChild(pContainer);
            cell.title = `${piece.owner} Piece`;
            cell.classList.add(piece.owner === 'red' ? 'cell--hidden-red' : 'cell--hidden-blue');
          }
        } else {
          cell.textContent = '';
          cell.title = 'Empty square';
        }

        cell.addEventListener('click', () => onCellClick(position));
      }

      container.appendChild(cell);
    }

    container.appendChild(createCoordLabel((row + 1).toString()));
  }

  container.appendChild(createCoordLabel(''));
  for (let col = 0; col < 10; col++) {
    container.appendChild(createCoordLabel(String.fromCharCode(65 + col)));
  }
  container.appendChild(createCoordLabel(''));

  return container;
}

function renderSidebar(): HTMLElement {
  const sidebar = document.createElement('div');
  sidebar.style.display = 'grid';
  sidebar.style.gap = '0.85rem';

  if (setupMode) {
    sidebar.appendChild(renderSetupBench());
    sidebar.appendChild(renderThemeSwitcher());
    sidebar.appendChild(renderRulesCard());
    return sidebar;
  }

  if (isAiThinking) {
    const thinkingCard = document.createElement('div');
    thinkingCard.style.padding = '0.85rem';
    thinkingCard.style.background = 'rgba(0, 0, 0, 0.04)';
    thinkingCard.style.border = '1px dashed #cbd5e1';
    thinkingCard.style.borderRadius = '10px';
    thinkingCard.style.display = 'flex';
    thinkingCard.style.alignItems = 'center';
    thinkingCard.style.justifyContent = 'center';
    thinkingCard.style.gap = '0.5rem';
    thinkingCard.style.fontSize = '0.82rem';
    thinkingCard.style.fontWeight = 'bold';
    
    const text = document.createElement('span');
    text.textContent = '🤖 AI Commander is planning... ';
    
    const loader = document.createElement('div');
    loader.style.display = 'flex';
    loader.style.gap = '3px';
    
    const dot1 = document.createElement('span');
    dot1.className = 'pulse-dot';
    const dot2 = document.createElement('span');
    dot2.className = 'pulse-dot';
    const dot3 = document.createElement('span');
    dot3.className = 'pulse-dot';
    
    loader.append(dot1, dot2, dot3);
    thinkingCard.append(text, loader);
    sidebar.appendChild(thinkingCard);
  }

  const controls = document.createElement('div');
  controls.style.display = 'grid';
  controls.style.gap = '0.5rem';

  const undoBtn = createButton('⏪ Undo Move', () => {
    if (undoStack.length > 0) {
      const prev = undoStack.pop();
      if (prev) {
        state = prev;
        selected = null;
        legalMoves = new Set();
        activeBattle = null;
        persistState();
        safeRender();
        sounds.playMove();
        logger.info('Move undone.');
      }
    }
  });
  undoBtn.style.padding = '0.5rem';
  undoBtn.style.fontSize = '0.8rem';
  undoBtn.style.borderRadius = '8px';
  undoBtn.style.fontWeight = 'bold';
  if (undoStack.length === 0 || isAiThinking) {
    undoBtn.disabled = true;
    undoBtn.style.opacity = '0.5';
    undoBtn.style.cursor = 'not-allowed';
  }

  const renameBtn = createButton('Rename Commander', () => {
    const nextName = window.prompt('Enter your commander name (letters/numbers/space):', playerName);
    if (!nextName) {
      return;
    }
    playerName = sanitizePlayerName(nextName);
    logger.info('Player name updated.', { playerName });
    safeRender();
  });
  renameBtn.style.padding = '0.5rem';
  renameBtn.style.fontSize = '0.8rem';
  renameBtn.style.borderRadius = '8px';

  const resetBtn = createButton('New Setup Draft', () => {
    const confirm = window.confirm('Are you sure you want to start a brand new game setup? Your current game will be lost.');
    if (!confirm) return;
    logger.info('Restarting game setup.');
    state = createSetupInitialState();
    setupMode = true;
    selected = null;
    legalMoves = new Set();
    activeBattle = null;
    isHeroAbilityUsed = false; // Reset Hero ability
    initializeSetupBench();
    persistState();
    safeRender();
  });
  resetBtn.style.padding = '0.5rem';
  resetBtn.style.fontSize = '0.8rem';
  resetBtn.style.borderRadius = '8px';

  const clearBtn = createButton('Clear Saved Game', () => {
    const confirm = window.confirm('Are you sure you want to wipe local storage?');
    if (!confirm) return;
    logger.info('Clearing saved game state.');
    localStorage.removeItem(STORAGE_KEY);
    state = createSetupInitialState();
    setupMode = true;
    selected = null;
    legalMoves = new Set();
    activeBattle = null;
    isHeroAbilityUsed = false; // Reset Hero ability
    initializeSetupBench();
    safeRender();
  });
  clearBtn.style.padding = '0.5rem';
  clearBtn.style.fontSize = '0.8rem';
  clearBtn.style.borderRadius = '8px';

  const aiToggleBtn = createButton(aiEnabled ? '🤖 AI Opponent: ON' : '👤 AI Opponent: OFF', () => {
    aiEnabled = !aiEnabled;
    logger.info('AI mode toggled.', { enabled: aiEnabled });
    safeRender();
  });
  aiToggleBtn.style.padding = '0.5rem';
  aiToggleBtn.style.fontSize = '0.8rem';
  aiToggleBtn.style.borderRadius = '8px';

  const diffToggleBtn = createButton(aiDifficulty === 'commander' ? '🤖 AI Level: COMMANDER (Hard)' : '👤 AI Level: RECRUIT (Easy)', () => {
    aiDifficulty = aiDifficulty === 'commander' ? 'recruit' : 'commander';
    logger.info('AI difficulty toggled.', { difficulty: aiDifficulty });
    safeRender();
  });
  diffToggleBtn.style.padding = '0.5rem';
  diffToggleBtn.style.fontSize = '0.8rem';
  diffToggleBtn.style.borderRadius = '8px';

  const aiPersonalityBtn = createButton(`🧠 AI Personality: ${aiPersonality.toUpperCase()}`, () => {
    const personalities: Array<'balanced' | 'rusher' | 'turtler'> = ['balanced', 'rusher', 'turtler'];
    const nextIdx = (personalities.indexOf(aiPersonality) + 1) % personalities.length;
    aiPersonality = personalities[nextIdx]!;
    logger.info('AI personality toggled.', { personality: aiPersonality });
    safeRender();
  });
  aiPersonalityBtn.style.padding = '0.5rem';
  aiPersonalityBtn.style.fontSize = '0.8rem';
  aiPersonalityBtn.style.borderRadius = '8px';

  const hardcoreFogBtn = createButton(hardcoreFogOfWar ? '👁️ Hardcore Fog: ACTIVE' : '👁️ Hardcore Fog: NORMAL', () => {
    hardcoreFogOfWar = !hardcoreFogOfWar;
    localStorage.setItem('stratego_hardcore_fog', hardcoreFogOfWar.toString());
    logger.info('Hardcore fog toggled.', { hardcore: hardcoreFogOfWar });
    safeRender();
  });
  hardcoreFogBtn.style.padding = '0.5rem';
  hardcoreFogBtn.style.fontSize = '0.8rem';
  hardcoreFogBtn.style.borderRadius = '8px';

  const heatmapToggleBtn = createButton(isHeatmapEnabled ? '🔥 Heatmap Overlay: ON' : '🔥 Heatmap Overlay: OFF', () => {
    isHeatmapEnabled = !isHeatmapEnabled;
    safeRender();
  });
  heatmapToggleBtn.style.padding = '0.5rem';
  heatmapToggleBtn.style.fontSize = '0.8rem';
  heatmapToggleBtn.style.borderRadius = '8px';

  const controlsToAppend = [undoBtn, renameBtn, aiToggleBtn, diffToggleBtn, aiPersonalityBtn, hardcoreFogBtn, heatmapToggleBtn];

  if (selected) {
    const currentSelected = selected;
    const piece = state.board[currentSelected.row]?.[currentSelected.col];
    if (piece && piece.kind === 'marshal' && piece.owner === 'red' && !isHeroAbilityUsed && state.currentPlayer === 'red') {
      const heroAbilityBtn = createButton('👑 Active Rally: Battle Cry', () => {
        const adjacentPositions: Position[] = [
          { row: currentSelected.row - 1, col: currentSelected.col },
          { row: currentSelected.row + 1, col: currentSelected.col },
          { row: currentSelected.row, col: currentSelected.col - 1 },
          { row: currentSelected.row, col: currentSelected.col + 1 }
        ];
        const validBlueAdjacent: Position[] = [];
        for (const pos of adjacentPositions) {
          if (pos.row >= 0 && pos.row < 10 && pos.col >= 0 && pos.col < 10) {
            const p = state.board[pos.row]?.[pos.col];
            if (p && p.owner === 'blue' && !p.revealed) {
              validBlueAdjacent.push(pos);
            }
          }
        }
        if (validBlueAdjacent.length > 0) {
          const randPos = validBlueAdjacent[Math.floor(Math.random() * validBlueAdjacent.length)]!;
          const targetPiece = state.board[randPos.row]![randPos.col]!;
          targetPiece.revealed = true;
          isHeroAbilityUsed = true;
          state.history.push(`👑 RALLY: Marshal used Battle Cry! Revealed Blue ${targetPiece.kind.toUpperCase()} at [${randPos.row},${randPos.col}]`);
          logger.info('Marshal active rally ability triggered.', { randPos, targetPiece });
          sounds.playVictory();
          persistState();
          safeRender();
        } else {
          alert('No adjacent unrevealed Blue pieces to reveal!');
        }
      });
      heroAbilityBtn.style.padding = '0.5rem';
      heroAbilityBtn.style.fontSize = '0.8rem';
      heroAbilityBtn.style.borderRadius = '8px';
      heroAbilityBtn.style.fontWeight = 'bold';
      heroAbilityBtn.style.background = 'linear-gradient(135deg, #fbbf24, #d97706)';
      heroAbilityBtn.style.color = '#ffffff';
      heroAbilityBtn.style.border = '1px solid #b45309';
      heroAbilityBtn.style.boxShadow = '0 0 10px rgba(251, 191, 36, 0.6)';
      heroAbilityBtn.style.cursor = 'pointer';
      
      controlsToAppend.push(heroAbilityBtn);
    }
  }

  controlsToAppend.push(resetBtn, clearBtn);
  controls.append(...controlsToAppend);

  const status = document.createElement('section');
  status.style.display = 'grid';
  status.style.gap = '0.35rem';

  const heading = document.createElement('h2');
  heading.textContent = 'Game Status';
  heading.style.margin = '0';
  heading.style.fontSize = '1.1rem';

  const winnerLine = document.createElement('p');
  winnerLine.style.margin = '0';
  winnerLine.textContent = state.winner
    ? `Winner: ${state.winner.toUpperCase()}`
    : `Current turn: ${state.currentPlayer.toUpperCase()}`;

  status.append(heading, winnerLine);

  const puzzleLabel = document.createElement('label');
  puzzleLabel.textContent = '🧩 Tactical Puzzles Minigame:';
  puzzleLabel.style.fontSize = '0.82rem';
  puzzleLabel.style.fontWeight = 'bold';
  puzzleLabel.style.marginTop = '0.45rem';
  
  const puzzleGrid = document.createElement('div');
  puzzleGrid.style.display = 'grid';
  puzzleGrid.style.gridTemplateColumns = '1fr 1fr';
  puzzleGrid.style.gap = '4px';
  
  const p1Btn = createButton('🕵️ Puzzle 1', () => loadPuzzleScenario(1));
  p1Btn.style.padding = '0.45rem';
  p1Btn.style.fontSize = '0.74rem';
  p1Btn.style.borderRadius = '6px';
  p1Btn.style.fontWeight = 'bold';
  
  const p2Btn = createButton('🏹 Puzzle 2', () => loadPuzzleScenario(2));
  p2Btn.style.padding = '0.45rem';
  p2Btn.style.fontSize = '0.74rem';
  p2Btn.style.borderRadius = '6px';
  p2Btn.style.fontWeight = 'bold';
  
  puzzleGrid.append(p1Btn, p2Btn);

  const puzzleSection = document.createElement('section');
  puzzleSection.style.display = 'grid';
  puzzleSection.style.gap = '4px';
  puzzleSection.style.paddingTop = '0.5rem';
  puzzleSection.style.borderTop = '1px solid #cbd5e1';
  puzzleSection.append(puzzleLabel, puzzleGrid);

  sidebar.append(controls, status, renderGraveyard(), renderTrophyCabinet(), puzzleSection, renderThemeSwitcher(), renderRulesCard());

  const historyHeadingContainer = document.createElement('div');
  historyHeadingContainer.style.display = 'flex';
  historyHeadingContainer.style.justifyContent = 'space-between';
  historyHeadingContainer.style.alignItems = 'center';
  historyHeadingContainer.style.margin = '0.4rem 0 0';
  
  const historyHeading = document.createElement('h3');
  historyHeading.textContent = 'Recent Battle Log';
  historyHeading.style.margin = '0';
  
  const clearHistoryBtn = document.createElement('button');
  clearHistoryBtn.type = 'button';
  clearHistoryBtn.textContent = 'Clear';
  clearHistoryBtn.style.padding = '2px 8px';
  clearHistoryBtn.style.fontSize = '0.68rem';
  clearHistoryBtn.style.cursor = 'pointer';
  clearHistoryBtn.style.borderRadius = '4px';
  clearHistoryBtn.addEventListener('click', () => {
    state.history = [];
    persistState();
    safeRender();
  });
  
  historyHeadingContainer.append(historyHeading, clearHistoryBtn);

  const list = document.createElement('ol');
  list.style.margin = '0';
  list.style.paddingLeft = '1rem';
  list.style.maxHeight = '14rem';
  list.style.overflow = 'auto';

  const recentHistory = [...state.history].slice(-10).reverse();
  for (const line of recentHistory) {
    const item = document.createElement('li');
    item.textContent = line;
    item.style.fontSize = '0.8rem';
    item.style.marginBottom = '0.25rem';
    
    if (line.includes('captured')) {
      item.className = 'log-victory';
    } else if (line.includes('lost to')) {
      item.className = 'log-defeat';
    } else if (line.includes('blown up') || line.includes('both removed') || line.includes('defused')) {
      item.className = 'log-explosion';
    }
    
    list.appendChild(item);
  }

  if (recentHistory.length === 0) {
    const item = document.createElement('p');
    item.textContent = 'No moves yet.';
    item.style.margin = '0';
    item.style.fontSize = '0.85rem';
    list.appendChild(item);
  }

  sidebar.append(historyHeadingContainer, list);

  if (runtime.debugMode) {
    sidebar.appendChild(renderDebugPanel());
  }

  return sidebar;
}

function renderDebugPanel(): HTMLElement {
  const panel = document.createElement('section');
  panel.style.marginTop = '0.4rem';
  panel.style.paddingTop = '0.6rem';
  panel.style.borderTop = '1px solid #cbd5e1';
  panel.style.display = 'grid';
  panel.style.gap = '0.5rem';

  const title = document.createElement('h3');
  title.textContent = 'Debug Diagnostics';
  title.style.margin = '0';

  const counts = countPiecesByOwner(state.board);

  const summary = document.createElement('pre');
  summary.style.margin = '0';
  summary.style.padding = '0.5rem';
  summary.style.background = '#f8fafc';
  summary.style.border = '1px solid #e2e8f0';
  summary.style.borderRadius = '8px';
  summary.style.fontSize = '0.73rem';
  summary.style.whiteSpace = 'pre-wrap';
  summary.textContent = JSON.stringify(
    {
      release: runtime.release,
      environment: runtime.environment,
      sessionId,
      moveCount: state.moveCount,
      currentPlayer: state.currentPlayer,
      winner: state.winner,
      selected,
      legalMoveCount: legalMoves.size,
      remainingPieces: counts,
      pendingErrorEvents: getErrorQueueDepth(),
      lastLog: latestLog
        ? {
            level: latestLog.level,
            scope: latestLog.scope,
            message: latestLog.message,
            timestamp: latestLog.timestamp,
          }
        : null,
    },
    null,
    2,
  );

  const copyButton = createButton('Copy Debug Snapshot', () => {
    const snapshot = JSON.stringify(buildDebugSnapshot(), null, 2);

    if (window.isSecureContext && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(snapshot)
        .then(() => {
          logger.info('Debug snapshot copied to clipboard.');
        })
        .catch((error: unknown) => {
          logger.warn('Failed to copy debug snapshot.', {
            reason: normalizeErrorMessage(error),
          });
        });
      return;
    }

    logger.warn('Clipboard API unavailable; debug snapshot logged to console instead.');
    console.info(snapshot);
  });

  const logs = document.createElement('div');
  logs.style.maxHeight = '10rem';
  logs.style.overflow = 'auto';
  logs.style.border = '1px solid #e2e8f0';
  logs.style.borderRadius = '8px';
  logs.style.padding = '0.4rem';

  const events = getRecentLogs(8).reverse();
  for (const event of events) {
    const item = document.createElement('div');
    item.style.fontSize = '0.72rem';
    item.style.marginBottom = '0.25rem';
    item.textContent = `${event.timestamp} [${event.level}] ${event.scope}: ${event.message}`;
    logs.appendChild(item);
  }

  panel.append(title, summary, copyButton, logs);
  return panel;
}

function buildDebugSnapshot(): Record<string, unknown> {
  return {
    runtime,
    sessionId,
    state: {
      currentPlayer: state.currentPlayer,
      winner: state.winner,
      moveCount: state.moveCount,
      historyTail: state.history.slice(-10),
      pieces: countPiecesByOwner(state.board),
    },
    selection: selected,
    legalMoves: [...legalMoves],
    aiEnabled,
    playerName,
    recentLogs: getRecentLogs(25),
    pendingErrorEvents: getErrorQueueDepth(),
  };
}

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  button.style.padding = '0.56rem 0.78rem';
  button.style.border = '1px solid #94a3b8';
  button.style.borderRadius = '10px';
  button.style.background = '#ffffff';
  button.style.cursor = 'pointer';
  button.style.fontWeight = '600';
  return button;
}

function onCellClick(position: Position): void {
  if (state.winner || isAiThinking) {
    return;
  }

  if (setupMode) {
    if (position.row < 6) {
      logger.warn('Red starting grid is rows 7-10.');
      return;
    }
    
    const existing = state.board[position.row]?.[position.col] ?? null;
    
    if (selectedBenchPiece !== null) {
      const board = cloneBoard(state.board);
      
      if (existing) {
        if (existing.owner === 'red') {
          setupBench.push(existing.kind);
        }
      }
      
      const newPiece: Piece = {
        id: `red-${selectedBenchPiece}-${Date.now()}-${position.row}-${position.col}`,
        kind: selectedBenchPiece,
        owner: 'red',
        revealed: false
      };
      board[position.row]![position.col] = newPiece;
      
      setupBench.splice(selectedBenchIndex, 1);
      selectedBenchPiece = null;
      selectedBenchIndex = -1;
      
      state = { ...state, board };
      persistState();
      safeRender();
      sounds.playMove();
    } else if (existing && existing.owner === 'red') {
      const board = cloneBoard(state.board);
      board[position.row]![position.col] = null;
      
      setupBench.push(existing.kind);
      
      state = { ...state, board };
      persistState();
      safeRender();
      sounds.playMove();
    }
    return;
  }

  if (selected && selected.row === position.row && selected.col === position.col) {
    selected = null;
    legalMoves = new Set();
    activeBattle = null;
    safeRender();
    return;
  }

  const piece = state.board[position.row]?.[position.col] ?? null;

  if (selected && legalMoves.has(positionToKey(position))) {
    logger.debug('Applying move.', {
      from: selected,
      to: position,
    });

    undoStack.push(cloneGameState(state));
    if (undoStack.length > 15) {
      undoStack.shift();
    }

    const attacker = state.board[selected.row]?.[selected.col] ?? null;
    const defender = state.board[position.row]?.[position.col] ?? null;
    
    // 1. Dotted Move Path Trail Indicator
    lastAppliedMove = { from: selected, to: position };
    // 2. Animated chess clock turn timer reset
    turnTimer = 45;
    
    if (attacker && defender) {
      activeBattle = {
        attacker: { kind: attacker.kind, owner: attacker.owner },
        defender: { kind: defender.kind, owner: defender.owner },
        resultText: resolveBattleResultText(attacker, defender),
        position,
      };

      const outcome = getBattleOutcome(attacker, defender);
      
      // 3. Increment Lifetime Trophy Cabinet Stats
      battlesCount++;
      localStorage.setItem('stratego_battles', battlesCount.toString());
      
      if (defender.kind === 'bomb') {
        sounds.playExplosion();
        recordDefuse();
      } else if (outcome === 'both') {
        sounds.playClash();
      } else {
        const humanWon = (outcome === 'attacker' && attacker.owner === 'red') || 
                         (outcome === 'defender' && defender.owner === 'red');
        if (humanWon) {
          sounds.playVictory();
          recordWin();
        } else {
          sounds.playDefeat();
          recordLoss();
        }
      }
      
      // Track survivals promotions!
      if (outcome === 'attacker') {
        promotionsMap[attacker.id] = (promotionsMap[attacker.id] || 0) + 1;
      } else if (outcome === 'defender') {
        promotionsMap[defender.id] = (promotionsMap[defender.id] || 0) + 1;
      }
      
      // Cache clash locations for the War Heatmap
      recordBattleClash(position.row, position.col);
      
      // 4. Trigger Tactical Screenshake
      const boardElement = document.querySelector('.board-container');
      if (boardElement) {
        boardElement.classList.add('shake-board');
        window.setTimeout(() => {
          boardElement.classList.remove('shake-board');
        }, 400);
      }
    } else {
      activeBattle = null;
      sounds.playMove();
    }

    state = applyMove(state, { from: selected, to: position });
    selected = null;
    legalMoves = new Set();
    persistState();
    safeRender();

    if (!state.winner && aiEnabled && state.currentPlayer === 'blue') {
      isAiThinking = true;
      safeRender();
      window.setTimeout(() => {
        runAiTurn();
        isAiThinking = false;
        safeRender();
      }, 1200);
    }
    return;
  }

  if (!piece || piece.owner !== state.currentPlayer) {
    selected = null;
    legalMoves = new Set();
    activeBattle = null;
    safeRender();
    return;
  }

  selected = position;
  legalMoves = new Set(getLegalMoves(state, position).map(positionToKey));
  activeBattle = null;
  logger.debug('Selected piece.', {
    piece: `${piece.owner}:${piece.kind}`,
    position,
    legalMoveCount: legalMoves.size,
  });
  safeRender();
}

function runAiTurn(): void {
  if (state.winner || state.currentPlayer !== 'blue') {
    return;
  }

  const move = chooseMove(state, 'blue', aiDifficulty, aiPersonality);
  if (!move) {
    logger.warn('AI could not find a legal move.');
    return;
  }

  logger.debug('AI move chosen.', { move });

  const attacker = state.board[move.from.row]?.[move.from.col] ?? null;
  const defender = state.board[move.to.row]?.[move.to.col] ?? null;
  
  // 1. visual Dotted Move Path Trail Indicator
  lastAppliedMove = move;
  // 2. Animated chess clock turn timer reset
  turnTimer = 45;
  
  if (attacker && defender) {
    activeBattle = {
      attacker: { kind: attacker.kind, owner: attacker.owner },
      defender: { kind: defender.kind, owner: defender.owner },
      resultText: resolveBattleResultText(attacker, defender),
      position: move.to,
    };

    const outcome = getBattleOutcome(attacker, defender);
    
    // 3. Increment Lifetime Trophy Cabinet Stats
    battlesCount++;
    localStorage.setItem('stratego_battles', battlesCount.toString());
    
    if (defender.kind === 'bomb') {
      sounds.playExplosion();
      if (outcome === 'attacker' && attacker.owner === 'red') {
        recordDefuse();
      }
    } else if (outcome === 'both') {
      sounds.playClash();
    } else {
      const humanWon = (outcome === 'attacker' && attacker.owner === 'red') || 
                       (outcome === 'defender' && defender.owner === 'red');
      if (humanWon) {
        sounds.playVictory();
        recordWin();
      } else {
        sounds.playDefeat();
        recordLoss();
      }
    }
    
    // Track survivals promotions!
    if (outcome === 'attacker') {
      promotionsMap[attacker.id] = (promotionsMap[attacker.id] || 0) + 1;
    } else if (outcome === 'defender') {
      promotionsMap[defender.id] = (promotionsMap[defender.id] || 0) + 1;
    }
    
    // Cache clash locations for the War Heatmap
    recordBattleClash(move.to.row, move.to.col);
    
    // 4. Trigger Screenshake
    const boardElement = document.querySelector('.board-container');
    if (boardElement) {
      boardElement.classList.add('shake-board');
      window.setTimeout(() => {
        boardElement.classList.remove('shake-board');
      }, 400);
    }
  } else {
    activeBattle = null;
    sounds.playMove();
  }

  state = applyMove(state, move);
  persistState();
  safeRender();
}
