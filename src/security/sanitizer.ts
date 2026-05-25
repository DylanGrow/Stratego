const SAFE_TEXT_PATTERN = /[^a-zA-Z0-9 _-]/g;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function sanitizeText(input: string, maxLength = 32): string {
  return input.replace(SAFE_TEXT_PATTERN, '').slice(0, maxLength).trim();
}

export function sanitizePlayerName(input: string): string {
  const cleaned = sanitizeText(input, 20);
  return cleaned.length > 0 ? cleaned : 'Commander';
}

export function normalizeRoomCode(input: string): string {
  return sanitizeText(input.toUpperCase(), 6).replace(/[^A-Z0-9]/g, '');
}

export function validateRoomCode(input: string): boolean {
  return ROOM_CODE_PATTERN.test(input);
}
