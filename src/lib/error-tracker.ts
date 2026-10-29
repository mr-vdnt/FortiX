import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.js';

export interface TrackedErrorEvent {
  id: string;
  fingerprint: string;
  timestamp: string;
  environment: string;
  release: string;
  source: 'server' | 'client';
  code: string;
  statusCode: number;
  message: string;
  method?: string;
  path?: string;
  requestId?: string;
  occurrences: number;
  spikeAlertTriggered: boolean;
  context?: Record<string, unknown>;
}

const MAX_TRACKED_ERRORS = 200;
const SPIKE_ALERT_THRESHOLD = 5;
const trackedErrors: TrackedErrorEvent[] = [];
const fingerprintIndex = new Map<string, TrackedErrorEvent>();

const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'secret',
  'secrethash',
  'passwordhash',
  'token',
  'tokenhash',
  'csrftoken',
  'rawkey',
  'apikey',
  'x-api-key',
  'x-fortix-token',
  'x-csrf-token',
  'authorization',
  'cookie',
  'set-cookie',
  'database_url',
  'redis_url',
  'jwt_secret',
  'encryption_key',
]);

export function scrubSensitiveString(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    // Connection URIs (Postgres, Redis, AMQP, HTTP with basic auth)
    .replace(/(?:postgres(?:ql)?|rediss?|amqp|https?):\/\/[^\s'"<>]+/gi, (match) => {
      if (match.includes('@') || /^(?:postgres|rediss?)/i.test(match)) {
        return '[REDACTED_CONNECTION_URI]';
      }
      return match.replace(/([?&](?:token|key|api_key|apikey|secret|password|sig|signature)=)[^&\s'"]+/gi, '$1[REDACTED]');
    })
    // Query parameter secrets in relative paths
    .replace(/([?&](?:token|reset_token|key|api_key|apikey|secret|password|jwt)=)[^&\s'"]+/gi, '$1[REDACTED]')
    // FortiX gateway keys
    .replace(/\bfx_(?:live|test)_[a-zA-Z0-9_]+\b/g, '[REDACTED_FORTIX_KEY]')
    // JWT tokens (3 base64url segments starting with eyJ)
    .replace(/\beyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    // GitHub PATs
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, '[REDACTED_PAT]')
    // Bearer / Basic headers inline
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    // Key=value pairs in SQL/config errors
    .replace(/\b(password|secret|token|apikey|api_key)\s*=\s*[^\s,;'"&]+/gi, '$1=[REDACTED]')
    // Mask email addresses to prevent PII exposure in error telemetry
    .replace(/\b([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, '$1***@$2')
    .slice(0, 500);
}

export function scrubSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED_DEPTH]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return scrubSensitiveString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => scrubSensitiveData(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const normalized = k.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (
        SENSITIVE_FIELD_NAMES.has(k.toLowerCase()) ||
        SENSITIVE_FIELD_NAMES.has(normalized) ||
        normalized.includes('password') ||
        normalized.includes('secret') ||
        normalized.includes('token') ||
        normalized.includes('cookie') ||
        normalized.includes('apikey')
      ) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubSensitiveData(v, depth + 1);
      }
    }
    return out;
  }

  return String(value);
}

export function getRecoveryHintForStatus(statusCode: number, code?: string): string {
  if (code === 'CSRF_TOKEN_INVALID' || code === 'CSRF_ORIGIN_DENIED') {
    return 'Reload the FortiX Control Plane tab to refresh your anti-CSRF session cookie and retry.';
  }
  switch (statusCode) {
    case 400:
    case 422:
      return 'Review the highlighted form fields and verify URLs, lengths, and numeric bounds before retrying.';
    case 401:
      return 'Your session has expired or been revoked. Sign in again to establish a fresh HttpOnly session.';
    case 403:
      return 'Your operator account does not have permission for this project or administrative resource.';
    case 404:
      return 'Verify the requested resource ID or return to the active project dashboard.';
    case 409:
      return 'Another update modified this resource concurrently. Refresh the current state and reapply your change.';
    case 429:
      return 'Rate limit or concurrency quota reached. Wait briefly for the token bucket window to replenish.';
    case 503:
      return 'A backing persistence dependency (PostgreSQL or Redis) is temporarily unavailable. Check System & Health.';
    default:
      return 'Retry the operation using the correlation ID if the issue persists.';
  }
}

export function captureTrackedError(params: {
  source: 'server' | 'client';
  code?: string;
  statusCode?: number;
  message: string;
  method?: string;
  path?: string;
  requestId?: string;
  context?: Record<string, unknown>;
}): TrackedErrorEvent {
  const safeMessage = scrubSensitiveString(params.message || 'Unexpected application error');
  const safePath = params.path ? scrubSensitiveString(params.path) : undefined;
  const code = params.code || 'INTERNAL_SERVER_ERROR';
  const statusCode = params.statusCode || 500;
  const environment = process.env.NODE_ENV || 'development';
  const release = process.env.FORTIX_RELEASE || '1.0.0';

  const fingerprint = crypto
    .createHash('sha256')
    .update(`${params.source}:${code}:${statusCode}:${safePath || ''}:${safeMessage}`)
    .digest('hex')
    .slice(0, 16);

  const safeContext = params.context
    ? (scrubSensitiveData(params.context) as Record<string, unknown>)
    : undefined;

  const existing = fingerprintIndex.get(fingerprint);
  const nowIso = new Date().toISOString();

  if (existing) {
    existing.occurrences += 1;
    existing.timestamp = nowIso;
    if (params.requestId) existing.requestId = params.requestId;
    if (safeContext) existing.context = safeContext;
    if (existing.occurrences >= SPIKE_ALERT_THRESHOLD && !existing.spikeAlertTriggered) {
      existing.spikeAlertTriggered = true;
      logger.warn(
        {
          fingerprint,
          occurrences: existing.occurrences,
          code: existing.code,
          path: existing.path,
        },
        '[ErrorTracker] Repeated error threshold reached — alert flagged'
      );
    }
    return existing;
  }

  const event: TrackedErrorEvent = {
    id: crypto.randomUUID(),
    fingerprint,
    timestamp: nowIso,
    environment,
    release,
    source: params.source,
    code,
    statusCode,
    message: safeMessage,
    method: params.method,
    path: safePath,
    requestId: params.requestId,
    occurrences: 1,
    spikeAlertTriggered: false,
    context: safeContext,
  };

  trackedErrors.unshift(event);
  fingerprintIndex.set(fingerprint, event);

  if (trackedErrors.length > MAX_TRACKED_ERRORS) {
    const evicted = trackedErrors.pop();
    if (evicted) {
      fingerprintIndex.delete(evicted.fingerprint);
    }
  }

  logger.error(
    {
      errorEventId: event.id,
      fingerprint: event.fingerprint,
      source: event.source,
      code: event.code,
      statusCode: event.statusCode,
      path: event.path,
      requestId: event.requestId,
    },
    `[ErrorTracker] ${event.message}`
  );

  const webhookUrl = process.env.ERROR_TRACKING_WEBHOOK_URL;
  if (webhookUrl && /^https?:\/\//i.test(webhookUrl)) {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => {
      // Never cascade error-tracker transport failures
    });
  }

  return event;
}

export function getTrackedErrors(limit = 50): TrackedErrorEvent[] {
  return trackedErrors.slice(0, Math.max(1, Math.min(limit, MAX_TRACKED_ERRORS)));
}

export function clearTrackedErrorsForTests(): void {
  trackedErrors.length = 0;
  fingerprintIndex.clear();
}

export function apiGlobalErrorHandler(
  err: any,
  req: Request & { id?: string },
  res: Response,
  _next: NextFunction
): void {
  const statusCode =
    typeof err?.status === 'number' && err.status >= 400 && err.status < 600
      ? err.status
      : typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600
        ? err.statusCode
        : err?.type === 'entity.parse.failed'
          ? 400
          : err?.type === 'entity.too.large'
            ? 413
            : 500;

  const code =
    typeof err?.code === 'string' && /^[A-Z0-9_]{3,40}$/.test(err.code)
      ? err.code
      : statusCode === 400
        ? 'INVALID_REQUEST_PAYLOAD'
        : statusCode === 413
          ? 'PAYLOAD_TOO_LARGE'
          : 'INTERNAL_SERVER_ERROR';

  captureTrackedError({
    source: 'server',
    code,
    statusCode,
    message: err?.message || 'Unhandled API exception',
    method: req.method,
    path: req.originalUrl || req.url,
    requestId: req.id,
    context: {
      headers: req.headers,
      query: req.query,
      body: req.body,
    },
  });

  // Never leak raw SQL, stack traces, or internal error messages on 5xx responses
  const safeClientMessage =
    statusCode === 400 && err?.type === 'entity.parse.failed'
      ? 'Malformed JSON request body.'
      : statusCode === 413
        ? 'Request payload exceeds maximum allowed size.'
        : statusCode < 500 && err?.expose
          ? scrubSensitiveString(String(err.message))
          : 'An unexpected server error occurred while processing the request.';

  if (res.headersSent) return;

  res.status(statusCode).json({
    error: safeClientMessage,
    code,
    requestId: req.id || 'unknown',
    recoveryHint: getRecoveryHintForStatus(statusCode, code),
  });
}
