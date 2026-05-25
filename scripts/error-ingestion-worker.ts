import {
  ERROR_INGESTION_SCHEMA_VERSION,
  type ErrorIngestionEvent,
  type ErrorIngestionRequest,
  type ErrorIngestionResponse,
} from '../src/observability/contract';

const MAX_REQUEST_BYTES = 48_000;
const MAX_EVENTS_PER_REQUEST = 10;

interface RuntimeEnv {
  STRATEGO_ERROR_EVENTS?: KVNamespace;
  STRATEGO_ERROR_DEDUP?: KVNamespace;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function createJsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function isObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function isValidEvent(event: unknown): event is ErrorIngestionEvent {
  if (!isObject(event)) {
    return false;
  }

  const schemaVersion = event.schemaVersion;
  const eventId = event.eventId;
  const occurredAt = event.occurredAt;
  const source = event.source;
  const release = event.release;
  const error = event.error;

  if (schemaVersion !== ERROR_INGESTION_SCHEMA_VERSION) {
    return false;
  }

  if (typeof eventId !== 'string' || eventId.length < 8 || eventId.length > 128) {
    return false;
  }

  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) {
    return false;
  }

  if (source !== 'window.error' && source !== 'window.unhandledrejection' && source !== 'manual') {
    return false;
  }

  if (typeof release !== 'string' || release.length === 0 || release.length > 128) {
    return false;
  }

  if (!isObject(error) || typeof error.message !== 'string' || error.message.length === 0) {
    return false;
  }

  if (error.message.length > 2000) {
    return false;
  }

  if (typeof event.requestUrl !== 'undefined' && typeof event.requestUrl !== 'string') {
    return false;
  }

  if (typeof event.userAgent !== 'undefined' && typeof event.userAgent !== 'string') {
    return false;
  }

  return true;
}

function parseRequest(input: unknown): { ok: true; request: ErrorIngestionRequest } | { ok: false; reason: string } {
  if (!isObject(input)) {
    return { ok: false, reason: 'Body must be a JSON object.' };
  }

  const events = input.events;
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, reason: '`events` must be a non-empty array.' };
  }

  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return {
      ok: false,
      reason: `Too many events per request; maximum is ${MAX_EVENTS_PER_REQUEST}.`,
    };
  }

  for (const event of events) {
    if (!isValidEvent(event)) {
      return { ok: false, reason: 'One or more events failed schema validation.' };
    }
  }

  return {
    ok: true,
    request: {
      events,
    },
  };
}

async function isDuplicateEvent(env: RuntimeEnv, eventId: string): Promise<boolean> {
  if (!env.STRATEGO_ERROR_DEDUP) {
    return false;
  }

  const key = `event:${eventId}`;
  const existing = await env.STRATEGO_ERROR_DEDUP.get(key);
  if (existing) {
    return true;
  }

  await env.STRATEGO_ERROR_DEDUP.put(key, '1', { expirationTtl: 60 * 60 * 24 });
  return false;
}

async function persistEvent(env: RuntimeEnv, event: ErrorIngestionEvent): Promise<void> {
  if (!env.STRATEGO_ERROR_EVENTS) {
    return;
  }

  const key = `${event.occurredAt}:${event.eventId}`;
  await env.STRATEGO_ERROR_EVENTS.put(key, JSON.stringify(event), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}

export default {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    if (request.method !== 'POST') {
      return createJsonResponse(405, {
        error: 'Method Not Allowed',
      });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return createJsonResponse(415, {
        error: 'Unsupported Media Type',
      });
    }

    const lengthHeader = request.headers.get('content-length');
    if (lengthHeader) {
      const declaredLength = Number(lengthHeader);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
        return createJsonResponse(413, {
          error: 'Payload Too Large',
          maxBytes: MAX_REQUEST_BYTES,
        });
      }
    }

    let rawBody = '';
    try {
      rawBody = await request.text();
    } catch {
      return createJsonResponse(400, {
        error: 'Invalid request body stream',
      });
    }

    if (rawBody.length > MAX_REQUEST_BYTES) {
      return createJsonResponse(413, {
        error: 'Payload Too Large',
        maxBytes: MAX_REQUEST_BYTES,
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return createJsonResponse(400, {
        error: 'Invalid JSON payload',
      });
    }

    const requestValidation = parseRequest(parsed);
    if (!requestValidation.ok) {
      return createJsonResponse(400, {
        error: 'Schema validation failed',
        reason: requestValidation.reason,
      });
    }

    let accepted = 0;
    let rejected = 0;

    for (const event of requestValidation.request.events) {
      const duplicate = await isDuplicateEvent(env, event.eventId);
      if (duplicate) {
        rejected += 1;
        continue;
      }

      await persistEvent(env, event);
      accepted += 1;
    }

    const response: ErrorIngestionResponse = {
      accepted,
      rejected,
      requestId: crypto.randomUUID(),
    };

    return createJsonResponse(202, response as unknown as Record<string, unknown>);
  },
};
