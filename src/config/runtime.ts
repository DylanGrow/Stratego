export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeConfig {
  environment: 'development' | 'production';
  release: string;
  apiEndpoint: string | null;
  debugMode: boolean;
  logLevel: RuntimeLogLevel;
  errorReportingEndpoint: string | null;
}

const LOG_LEVELS: RuntimeLogLevel[] = ['debug', 'info', 'warn', 'error'];

function readQueryParams(): URLSearchParams {
  if (typeof window === 'undefined') {
    return new URLSearchParams();
  }

  return new URLSearchParams(window.location.search);
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function normalizeValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseLogLevel(input: string | undefined): RuntimeLogLevel | null {
  if (!input) {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  return LOG_LEVELS.includes(normalized as RuntimeLogLevel)
    ? (normalized as RuntimeLogLevel)
    : null;
}

export function readRuntimeConfig(): RuntimeConfig {
  const query = readQueryParams();
  const queryDebug = query.get('debug') ?? undefined;
  const queryLogLevel = query.get('logLevel') ?? undefined;

  const environment = import.meta.env.PROD ? 'production' : 'development';

  const debugMode =
    parseBoolean(queryDebug, false) ||
    parseBoolean(import.meta.env.VITE_DEBUG_MODE, false) ||
    environment === 'development';

  const logLevel =
    parseLogLevel(queryLogLevel) ??
    parseLogLevel(import.meta.env.VITE_LOG_LEVEL) ??
    (debugMode ? 'debug' : 'info');

  return {
    environment,
    release: normalizeValue(import.meta.env.VITE_RELEASE) ?? 'dev-local',
    apiEndpoint: normalizeValue(import.meta.env.VITE_API_ENDPOINT),
    debugMode,
    logLevel,
    errorReportingEndpoint: normalizeValue(import.meta.env.VITE_ERROR_REPORTING_ENDPOINT),
  };
}
