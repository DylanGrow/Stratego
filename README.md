# Stratego - Production-Ready Web Game

Stratego scaffold with enterprise-focused foundations:

- Strict TypeScript and deterministic game engine
- Structured runtime logging with in-memory log buffer
- Global error capture (`window.error`, `unhandledrejection`)
- Optional outbound error reporting endpoint
- PWA + offline support
- Unit tests and CI quality gates

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Quality Gates

```bash
npm run lint
npm run type-check
npm run test
npm run test:e2e
npm run build
npm run quality-gate
```

## Production Build

```bash
npm run build
npm run generate-sitemap
npm run generate-headers
```

Build output includes hidden sourcemaps for production debugging.

## Runtime Diagnostics

### Debug Mode

Enable debug mode in one of two ways:

1. Add `?debug=1` to the URL.
2. Set `VITE_DEBUG_MODE=true`.

When enabled, the UI shows a diagnostics panel with:

- Runtime and release info
- Selected piece and legal move context
- Piece inventory by side
- Recent structured logs
- Copyable debug snapshot

### Runtime Environment Variables

See [.env.example](.env.example) for all options:

- `VITE_API_ENDPOINT`
- `VITE_RELEASE`
- `VITE_LOG_LEVEL`
- `VITE_DEBUG_MODE`
- `VITE_ERROR_REPORTING_ENDPOINT`

## E2E Smoke Tests

Playwright smoke suite covers:

- app startup and board render
- basic move flow
- AI response turn
- crash fallback UI

Run locally:

```bash
npm run test:e2e
```

Spec file: [smoke.spec.ts](C:/Users/psdgr/Downloads/files/stratego-game/e2e/smoke.spec.ts)

## Error Ingestion Contract

Client payload and retry behavior are documented and versioned:

- [ERROR_INGESTION.md](C:/Users/psdgr/Downloads/files/stratego-game/docs/ERROR_INGESTION.md)
- [error-ingestion-worker.ts](C:/Users/psdgr/Downloads/files/stratego-game/scripts/error-ingestion-worker.ts)

## Project Structure

```text
stratego-game/
  src/
    config/
      runtime.ts
    observability/
      logger.ts
      errors.ts
    game/
      engine.ts
      types.ts
      ai.ts
    services/
      multiplayer.ts
      sessionManager.ts
    security/
      sanitizer.ts
    styles/
      globals.css
    main.ts
  test/
    engine.test.ts
  docs/
    ARCHITECTURE.md
    BACKEND_SETUP.md
    SECURITY.md
    API.md
    DEBUGGING.md
    PRODUCTION_CHECKLIST.md
```

## CI/CD

GitHub Actions workflow runs:

1. Lint
2. Type check
3. Unit tests
4. Production build
5. Sitemap and headers generation
6. Pages deployment

Workflow file: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
