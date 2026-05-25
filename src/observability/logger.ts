import type { RuntimeLogLevel } from '../config/runtime';

export type LogLevel = RuntimeLogLevel;

export interface LogEvent {
  scope: string;
  level: LogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface Logger {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
  child: (scope: string) => Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MAX_BUFFERED_EVENTS = 200;

let activeLevel: LogLevel = 'info';
const logBuffer: LogEvent[] = [];
const listeners = new Set<(event: LogEvent) => void>();

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[activeLevel];
}

function pushLog(event: LogEvent): void {
  logBuffer.push(event);
  if (logBuffer.length > MAX_BUFFERED_EVENTS) {
    logBuffer.shift();
  }

  for (const listener of listeners) {
    listener(event);
  }
}

function emitConsole(event: LogEvent): void {
  const prefix = `[${event.timestamp}] [${event.level.toUpperCase()}] [${event.scope}]`;
  const payload = event.metadata && Object.keys(event.metadata).length > 0 ? event.metadata : undefined;

  if (event.level === 'error') {
    if (payload) {
      console.error(prefix, event.message, payload);
    } else {
      console.error(prefix, event.message);
    }
    return;
  }

  if (event.level === 'warn') {
    if (payload) {
      console.warn(prefix, event.message, payload);
    } else {
      console.warn(prefix, event.message);
    }
    return;
  }

  if (event.level === 'info') {
    if (payload) {
      console.info(prefix, event.message, payload);
    } else {
      console.info(prefix, event.message);
    }
    return;
  }

  if (payload) {
    console.debug(prefix, event.message, payload);
  } else {
    console.debug(prefix, event.message);
  }
}

function emit(scope: string, level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
  if (!shouldEmit(level)) {
    return;
  }

  const event: LogEvent = {
    scope,
    level,
    message,
    timestamp: new Date().toISOString(),
    metadata,
  };

  pushLog(event);
  emitConsole(event);
}

export function initializeLogging(level: LogLevel): void {
  activeLevel = level;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, metadata) => emit(scope, 'debug', message, metadata),
    info: (message, metadata) => emit(scope, 'info', message, metadata),
    warn: (message, metadata) => emit(scope, 'warn', message, metadata),
    error: (message, metadata) => emit(scope, 'error', message, metadata),
    child: (childScope) => createLogger(`${scope}.${childScope}`),
  };
}

export function getRecentLogs(limit = 40): LogEvent[] {
  return logBuffer.slice(Math.max(0, logBuffer.length - limit));
}

export function subscribeToLogs(listener: (event: LogEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveLogLevel(): LogLevel {
  return activeLevel;
}
