export const ERROR_INGESTION_SCHEMA_VERSION = '1.0.0';

export type ErrorSource = 'window.error' | 'window.unhandledrejection' | 'manual';

export interface ErrorIngestionEvent {
  schemaVersion: typeof ERROR_INGESTION_SCHEMA_VERSION;
  eventId: string;
  occurredAt: string;
  source: ErrorSource;
  release: string;
  requestUrl?: string;
  userAgent?: string;
  error: {
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface ErrorIngestionRequest {
  events: ErrorIngestionEvent[];
}

export interface ErrorIngestionResponse {
  accepted: number;
  rejected: number;
  requestId: string;
}

export interface ErrorDeliveryPolicy {
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  requestTimeoutMs: number;
}

export const DEFAULT_ERROR_DELIVERY_POLICY: ErrorDeliveryPolicy = {
  maxAttempts: 3,
  initialBackoffMs: 1_000,
  maxBackoffMs: 8_000,
  requestTimeoutMs: 4_000,
};
