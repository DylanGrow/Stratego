import { normalizeRoomCode, sanitizePlayerName, validateRoomCode } from '../security/sanitizer';

export interface PlayerSession {
  playerName: string;
  roomCode: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class SessionManager {
  createRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let index = 0; index < 6; index += 1) {
      const position = Math.floor(Math.random() * chars.length);
      code += chars[position] ?? 'A';
    }
    return code;
  }

  createSession(playerName: string, roomCode: string): PlayerSession {
    const now = Date.now();
    const safeName = sanitizePlayerName(playerName);
    const normalizedCode = normalizeRoomCode(roomCode);

    if (!validateRoomCode(normalizedCode)) {
      throw new Error('Invalid room code format. Expected 6 uppercase alphanumeric characters.');
    }

    return {
      playerName: safeName,
      roomCode: normalizedCode,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
  }

  isExpired(session: PlayerSession): boolean {
    return session.expiresAt <= Date.now();
  }
}
