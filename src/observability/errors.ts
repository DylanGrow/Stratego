import {
  DEFAULT_ERROR_DELIVERY_POLICY,
  ERROR_INGESTION_SCHEMA_VERSION,
  type ErrorDeliveryPolicy,
  type ErrorIngestionEvent,
  type ErrorSource,
} from './contract';
import { createLogger, type Logger } from './logger';

interface ErrorHandlerOptions {
  release: string;
  endpoint?: string | null;
  logger?: Logger;
  deliveryPolicy?: Partial<ErrorDeliveryPolicy>;
}

interface PendingDelivery {
  endpoint: string;
  event: ErrorIngestionEvent;
  attempt: number;
}

const defaultLogger = createLogger('errors');
const capturedWindowErrors = new WeakSet<Error>();
const recentTimestamps: number[] = [];
const deliveryQueue: PendingDelivery[] = [];
const permanentFailureStatusCodes = new Set([400, 401, 403, 404, 405, 409, 410, 413, 415, 422]);

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInProgress = false;
let onlineListenerInstalled = false;
let activeDeliveryPolicy: ErrorDeliveryPolicy = DEFAULT_ERROR_DELIVERY_POLICY;

function normalizeError(input: unknown): { message: string; stack?: string } {
  if (input instanceof Error) {
    return {
      message: input.message,
      stack: input.stack,
    };
  }

  if (typeof input === 'string') {
    return { message: input };
  }

  return { message: 'Unknown error' };
}

function generateEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function canRecordNow(maxPerMinute = 25): boolean {
  const now = Date.now();
  while (recentTimestamps.length > 0 && now - (recentTimestamps[0] ?? now) > 60_000) {
    recentTimestamps.shift();
  }

  if (recentTimestamps.length >= maxPerMinute) {
    return false;
  }

  recentTimestamps.push(now);
  return true;
}

function mergeDeliveryPolicy(policy?: Partial<ErrorDeliveryPolicy>): ErrorDeliveryPolicy {
  return {
    maxAttempts: policy?.maxAttempts ?? DEFAULT_ERROR_DELIVERY_POLICY.maxAttempts,
    initialBackoffMs: policy?.initialBackoffMs ?? DEFAULT_ERROR_DELIVERY_POLICY.initialBackoffMs,
    maxBackoffMs: policy?.maxBackoffMs ?? DEFAULT_ERROR_DELIVERY_POLICY.maxBackoffMs,
    requestTimeoutMs: policy?.requestTimeoutMs ?? DEFAULT_ERROR_DELIVERY_POLICY.requestTimeoutMs,
  };
}

function buildEvent(
  source: ErrorSource,
  release: string,
  normalized: { message: string; stack?: string },
  metadata?: Record<string, unknown>,
): ErrorIngestionEvent {
  return {
    schemaVersion: ERROR_INGESTION_SCHEMA_VERSION,
    eventId: generateEventId(),
    occurredAt: new Date().toISOString(),
    source,
    release,
    requestUrl: typeof window === 'undefined' ? undefined : window.location.href,
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
    error: {
      message: normalized.message,
      stack: normalized.stack,
    },
    metadata,
  };
}

function isRetryableStatus(status: number): boolean {
  return !permanentFailureStatusCodes.has(status);
}

function calculateBackoffMs(attempt: number): number {
  const exponential = activeDeliveryPolicy.initialBackoffMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(activeDeliveryPolicy.maxBackoffMs, exponential);
}

function scheduleFlush(delayMs: number, logger: Logger): void {
  if (flushTimer !== null) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushQueue(logger);
  }, delayMs);
}

function enqueueForDelivery(endpoint: string, event: ErrorIngestionEvent, logger: Logger): void {
  deliveryQueue.push({
    endpoint,
    event,
    attempt: 1,
  });

  logger.debug('Queued error event for delivery', {
    endpoint,
    eventId: event.eventId,
    queueDepth: deliveryQueue.length,
  });

  scheduleFlush(0, logger);
}

function installOnlineListener(logger: Logger): void {
  if (onlineListenerInstalled || typeof window === 'undefined') {
    return;
  }

  window.addEventListener('online', () => {
    logger.info('Network restored; retrying queued error events.', {
      queueDepth: deliveryQueue.length,
    });
    scheduleFlush(0, logger);
  });

  onlineListenerInstalled = true;
}

async function transmitDelivery(item: PendingDelivery, logger: Logger): Promise<'success' | 'retry' | 'drop'> {
  const requestBody = JSON.stringify({ events: [item.event] });

  if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' && !navigator.onLine) {
    return 'retry';
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), activeDeliveryPolicy.requestTimeoutMs);

  try {
    const response = await fetch(item.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stratego-Schema-Version': item.event.schemaVersion,
        'X-Stratego-Event-Id': item.event.eventId,
        'X-Stratego-Delivery-Attempt': String(item.attempt),
      },
      body: requestBody,
      keepalive: true,
      signal: controller.signal,
    });

    if (response.ok) {
      logger.info('Error event accepted by ingestion endpoint', {
        endpoint: item.endpoint,
        eventId: item.event.eventId,
        attempt: item.attempt,
      });
      return 'success';
    }

    if (isRetryableStatus(response.status)) {
      logger.warn('Error ingestion returned retryable status', {
        endpoint: item.endpoint,
        eventId: item.event.eventId,
        status: response.status,
        attempt: item.attempt,
      });
      return 'retry';
    }

    logger.error('Error ingestion returned non-retryable status', {
      endpoint: item.endpoint,
      eventId: item.event.eventId,
      status: response.status,
      attempt: item.attempt,
    });
    return 'drop';
  } catch (reason: unknown) {
    logger.warn('Error ingestion request failed; will retry if attempts remain', {
      endpoint: item.endpoint,
      eventId: item.event.eventId,
      attempt: item.attempt,
      reason: normalizeError(reason).message,
    });
    return 'retry';
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function flushQueue(logger: Logger): Promise<void> {
  if (flushInProgress) {
    return;
  }

  flushInProgress = true;

  try {
    while (deliveryQueue.length > 0) {
      const current = deliveryQueue[0];
      if (!current) {
        break;
      }

      const result = await transmitDelivery(current, logger);

      if (result === 'success' || result === 'drop') {
        deliveryQueue.shift();
        continue;
      }

      if (current.attempt >= activeDeliveryPolicy.maxAttempts) {
        logger.error('Dropping error event after max retry attempts', {
          endpoint: current.endpoint,
          eventId: current.event.eventId,
          maxAttempts: activeDeliveryPolicy.maxAttempts,
        });
        deliveryQueue.shift();
        continue;
      }

      current.attempt += 1;
      const waitMs = calculateBackoffMs(current.attempt);
      scheduleFlush(waitMs, logger);
      return;
    }
  } finally {
    flushInProgress = false;
  }
}

function report(event: ErrorIngestionEvent, endpoint: string | null | undefined, logger: Logger): void {
  logger.error('Captured application error', {
    source: event.source,
    message: event.error.message,
    eventId: event.eventId,
  });

  if (!endpoint) {
    return;
  }

  enqueueForDelivery(endpoint, event, logger);
  installOnlineListener(logger);
}

export function installGlobalErrorHandlers(options: ErrorHandlerOptions): void {
  const logger = options.logger ?? defaultLogger;
  activeDeliveryPolicy = mergeDeliveryPolicy(options.deliveryPolicy);

  if (typeof window === 'undefined') {
    return;
  }

  window.addEventListener('error', (event) => {
    if (!canRecordNow()) {
      return;
    }

    if (event.error instanceof Error && capturedWindowErrors.has(event.error)) {
      return;
    }

    if (event.error instanceof Error) {
      capturedWindowErrors.add(event.error);
    }

    const normalized = normalizeError(event.error ?? event.message);
    const payload = buildEvent('window.error', options.release, normalized, {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });

    report(payload, options.endpoint, logger);
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (!canRecordNow()) {
      return;
    }

    const normalized = normalizeError(event.reason);
    const payload = buildEvent('window.unhandledrejection', options.release, normalized);

    report(payload, options.endpoint, logger);
  });
}

export function captureException(
  error: unknown,
  context: Record<string, unknown>,
  release: string,
  endpoint?: string | null,
): void {
  if (!canRecordNow()) {
    return;
  }

  const normalized = normalizeError(error);
  const payload = buildEvent('manual', release, normalized, context);

  report(payload, endpoint, defaultLogger);
}

export function getErrorQueueDepth(): number {
  return deliveryQueue.length;
}
