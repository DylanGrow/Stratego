# Production Readiness Checklist

## Release Inputs

- [ ] `VITE_RELEASE` set to immutable release/build ID
- [ ] `VITE_API_ENDPOINT` points to production backend (if multiplayer enabled)
- [ ] `VITE_ERROR_REPORTING_ENDPOINT` configured and reachable
- [ ] `VITE_LOG_LEVEL` set to `info` or stricter

## Pre-Deploy Validation

- [ ] `npm ci`
- [ ] `npm run quality-gate`
- [ ] `npm run generate-sitemap`
- [ ] `npm run generate-headers`

## Security and Reliability

- [ ] CSP and security headers generated in build output
- [ ] Offline fallback page present
- [ ] Service worker builds without warnings
- [ ] State validation passes for restore path
- [ ] Error telemetry path validated in staging

## Observability

- [ ] Logs include release and environment context
- [ ] Error payloads include stack traces when available
- [ ] Production hidden sourcemaps retained in artifact pipeline

## Deployment

- [ ] GitHub Actions workflow green
- [ ] Artifact uploaded to GitHub Pages
- [ ] Post-deploy smoke test confirms board interaction and AI turn loop
