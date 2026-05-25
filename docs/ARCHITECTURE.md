# Architecture

## Overview

Stratego uses a client-first architecture:

1. Frontend: Vite + TypeScript UI and game interaction.
2. Engine: Deterministic game rules in `src/game/engine.ts`.
3. Security: Input normalization and validation utilities in `src/security`.
4. Observability: Structured logs and global error capture in `src/observability`.
5. Runtime config: Environment/query-driven toggles in `src/config/runtime.ts`.
6. Optional backend: Cloudflare Worker to synchronize rooms.

## Core Data Flow

1. User clicks a square.
2. UI asks the engine for legal moves.
3. Engine validates and applies the move.
4. Updated state is rendered and persisted to localStorage.
5. If multiplayer endpoint exists, move can be sent through `IMultiplayerService`.

## Service Layer

- `LocalMultiplayerService`: local-only mode.
- `CloudflareMultiplayerService`: online room sync.
- Both conform to one interface for easy swapping.

## Offline Design

- PWA registration through Vite plugin.
- Static assets cached by generated service worker.
- Game state persisted in localStorage.

## Quality Gates

- Lint: `npm run lint`
- Type check: `npm run type-check`
- Tests with coverage thresholds: `npm run test:coverage`
- Production build: `npm run build`
