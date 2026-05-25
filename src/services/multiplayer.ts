import type { GameState, Move } from '../game/types';

export interface IMultiplayerService {
  createRoom(initialState: GameState): Promise<string>;
  joinRoom(roomCode: string): Promise<GameState | null>;
  submitMove(roomCode: string, move: Move): Promise<void>;
  getState(roomCode: string): Promise<GameState | null>;
}

class LocalMultiplayerService implements IMultiplayerService {
  private readonly storagePrefix = 'stratego-room-';

  async createRoom(initialState: GameState): Promise<string> {
    const code = this.generateCode();
    localStorage.setItem(this.key(code), JSON.stringify(initialState));
    return code;
  }

  async joinRoom(roomCode: string): Promise<GameState | null> {
    return this.getState(roomCode);
  }

  async submitMove(roomCode: string, _move: Move): Promise<void> {
    const roomKey = this.key(roomCode);
    const existing = localStorage.getItem(roomKey);
    if (!existing) {
      throw new Error('Room not found');
    }
  }

  async getState(roomCode: string): Promise<GameState | null> {
    const serialized = localStorage.getItem(this.key(roomCode));
    if (!serialized) {
      return null;
    }

    try {
      return JSON.parse(serialized) as GameState;
    } catch {
      return null;
    }
  }

  private key(roomCode: string): string {
    return `${this.storagePrefix}${roomCode}`;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      const index = Math.floor(Math.random() * chars.length);
      code += chars[index] ?? 'A';
    }
    return code;
  }
}

class CloudflareMultiplayerService implements IMultiplayerService {
  constructor(private readonly endpoint: string) {}

  async createRoom(initialState: GameState): Promise<string> {
    const response = await fetch(`${this.endpoint}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initialState }),
    });
    const payload = (await response.json()) as { roomCode: string };
    return payload.roomCode;
  }

  async joinRoom(roomCode: string): Promise<GameState | null> {
    return this.getState(roomCode);
  }

  async submitMove(roomCode: string, move: Move): Promise<void> {
    await fetch(`${this.endpoint}/rooms/${roomCode}/moves`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(move),
    });
  }

  async getState(roomCode: string): Promise<GameState | null> {
    const response = await fetch(`${this.endpoint}/rooms/${roomCode}`);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as GameState;
  }
}

export function createMultiplayerService(endpoint?: string): IMultiplayerService {
  if (endpoint && endpoint.trim().length > 0) {
    return new CloudflareMultiplayerService(endpoint);
  }

  return new LocalMultiplayerService();
}
