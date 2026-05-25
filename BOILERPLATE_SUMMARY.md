# Boilerplate Summary

The `stratego-game` scaffold is now created with:

- Build/config files (`package.json`, `vite.config.ts`, `tsconfig.json`, Tailwind, PostCSS)
- Core game engine (`src/game/engine.ts`) and types
- AI move selector (`src/game/ai.ts`)
- Security and session utilities
- Optional multiplayer abstraction for local/cloud modes
- Runtime observability (`src/observability/*`) with structured logs and global error capture
- Runtime config controls (`src/config/runtime.ts`) for release/debug/log levels
- Offline assets (`public/offline.html`, PWA config, icon)
- Scripts for sitemap and security headers
- Unit tests (`test/engine.test.ts`) and Vitest config (`vitest.config.ts`)
- GitHub Pages workflow with quality gates (lint, type-check, tests, build)
- Architecture, backend setup, API, and security docs

Run:

```bash
npm install
npm run quality-gate
npm run dev
```
