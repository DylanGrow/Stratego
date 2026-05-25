# Security Notes

## Frontend Safety

- User inputs are sanitized (`sanitizeText`, `sanitizePlayerName`, `normalizeRoomCode`).
- No direct HTML interpolation from user-controlled strings.
- CSP and strict headers generated in `scripts/generate-headers.ts`.

## Game Integrity

- Engine enforces legal movement by piece type.
- Turn order is enforced in state transitions.
- Lake squares and immovable pieces are blocked by rule checks.

## Multiplayer Considerations

When backend is enabled:

- Validate every move server-side.
- Enforce room code format and expiration.
- Apply rate limiting per IP/session.
- Expire sessions after 24 hours.
