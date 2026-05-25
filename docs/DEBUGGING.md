# Debugging Guide

## Runtime Controls

- URL debug flag: `?debug=1`
- URL log override: `?logLevel=debug`
- URL forced crash simulation: `?debug=1&forceRenderCrash=1`
- Env overrides: `VITE_DEBUG_MODE`, `VITE_LOG_LEVEL`

## Built-in Diagnostics

When debug mode is active, the sidebar diagnostics panel provides:

- Current release and environment
- Session identifier
- Material counts by side
- Current selection / legal move count
- Recent structured logs
- Copyable JSON snapshot

## Error Handling

Global handlers are installed for:

- `window.error`
- `window.unhandledrejection`

If `VITE_ERROR_REPORTING_ENDPOINT` is configured, payloads are sent with `fetch` and client-managed retry.
Delivery uses exponential backoff and online-resume queue flushing.

## Local Troubleshooting Commands

```bash
npm run lint
npm run type-check
npm run test
npm run build
npm run preview
```

## Incident Playbook

1. Reproduce with `?debug=1&logLevel=debug`.
2. Copy diagnostics snapshot from UI.
3. Capture browser console output.
4. Validate build and tests locally.
5. If online multiplayer is enabled, correlate with backend logs by release and timestamp.
