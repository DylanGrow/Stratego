# Quick Start Guide

## 1. Install Dependencies

```bash
npm install
```

## 2. Start Dev Server

```bash
npm run dev
```

Visit `http://localhost:5173`.

## 3. Verify Build

```bash
npm run build
```

## Useful Commands

```bash
npm run type-check
npm run lint
npm run test
npm run test:e2e
npm run quality-gate
npm run preview
npm run generate-sitemap
npm run generate-headers
```

## Enabling Online Multiplayer Later

1. Deploy Cloudflare Worker.
2. Set `VITE_API_ENDPOINT` in `.env.local`.
3. Restart `npm run dev`.
