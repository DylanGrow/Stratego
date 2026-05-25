# Cloudflare Backend Setup

## 1. Create Worker

```bash
npm install -g wrangler
wrangler login
wrangler init stratego-backend
```

## 2. Configure KV

Create a KV namespace and place IDs in `wrangler.toml`.

```toml
[[kv_namespaces]]
binding = "STRATEGO_SESSIONS"
id = "your-kv-id"
preview_id = "your-preview-id"
```

## 3. Implement Endpoints

Required routes:

- `POST /rooms`
- `GET /rooms/:code`
- `POST /rooms/:code/moves`
- `POST /v1/errors` (client error ingestion)

## 4. Deploy

```bash
wrangler deploy
```

## 5. Connect Frontend

Set endpoint in `.env.local`:

```bash
VITE_API_ENDPOINT=https://your-worker.workers.dev
```

Restart dev server and multiplayer abstraction will route API calls to Worker endpoints.

## Error Ingestion Endpoint

Use [error-ingestion-worker.ts](C:/Users/psdgr/Downloads/files/stratego-game/scripts/error-ingestion-worker.ts) as a starting point.

Recommended KV bindings:

- `STRATEGO_ERROR_EVENTS`: retained error events
- `STRATEGO_ERROR_DEDUP`: dedup cache by `eventId`

Detailed payload/response contract:

- [ERROR_INGESTION.md](C:/Users/psdgr/Downloads/files/stratego-game/docs/ERROR_INGESTION.md)
