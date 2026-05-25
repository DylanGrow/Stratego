# Error Ingestion Contract

## Endpoint

- Method: `POST`
- Path: `/v1/errors`
- Content-Type: `application/json`

## Request Payload

The request body must match:

- [error-ingestion-request.schema.json](C:/Users/psdgr/Downloads/files/stratego-game/docs/contracts/error-ingestion-request.schema.json)
- [error-ingestion-event.schema.json](C:/Users/psdgr/Downloads/files/stratego-game/docs/contracts/error-ingestion-event.schema.json)

Shape:

```json
{
  "events": [
    {
      "schemaVersion": "1.0.0",
      "eventId": "evt-1234",
      "occurredAt": "2026-05-25T22:00:00.000Z",
      "source": "window.error",
      "release": "2026.05.25+build42",
      "requestUrl": "https://example.com/",
      "userAgent": "Mozilla/5.0 ...",
      "error": {
        "message": "TypeError: ...",
        "stack": "..."
      },
      "metadata": {
        "line": 42,
        "column": 7
      }
    }
  ]
}
```

## Response Contract

### `202 Accepted`

```json
{
  "accepted": 1,
  "rejected": 0,
  "requestId": "b6d4..."
}
```

### Non-retryable status codes (client drops)

- `400` Bad Request
- `401` Unauthorized
- `403` Forbidden
- `404` Not Found
- `405` Method Not Allowed
- `409` Conflict
- `410` Gone
- `413` Payload Too Large
- `415` Unsupported Media Type
- `422` Unprocessable Entity

### Retryable status codes (client retries)

- `429` Too Many Requests
- `5xx` Server errors
- Network failures / timeouts

## Client Retry Policy

Default frontend policy (`src/observability/errors.ts`):

- Max attempts: `3`
- Backoff: exponential (`1s`, `2s`, `4s`), capped by policy
- Timeout per request: `4s`
- Queue flushes automatically when browser returns online

## Reference Worker

A ready-to-adapt Cloudflare Worker implementation is provided at:

- [scripts/error-ingestion-worker.ts](C:/Users/psdgr/Downloads/files/stratego-game/scripts/error-ingestion-worker.ts)

It implements:

- JSON schema-like structural validation
- Max body size enforcement
- Event dedup by `eventId` (KV-backed)
- 30-day retention example in KV
