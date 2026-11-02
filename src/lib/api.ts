let memoryCsrfToken: string | null = null;
let memorySessionToken: string | null = null;
let memoryProjectId: string | null = null;

export function safeStorageGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore cross-origin iframe third-party storage restrictions
  }
}

export function safeStorageRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore cross-origin iframe third-party storage restrictions
  }
}

// Purge any legacy bearer token left in localStorage from older versions
safeStorageRemove('fortix_token');

export function setMemorySessionToken(token?: string | null): void {
  if (typeof token === 'string' && token.length > 0) {
    memorySessionToken = token;
  } else if (token === null) {
    memorySessionToken = null;
  }
}

export function getMemorySessionToken(): string | null {
  return memorySessionToken;
}

export function setCsrfToken(token?: string | null): void {
  if (typeof token === 'string' && token.length > 0) {
    memoryCsrfToken = token;
  } else if (token === null) {
    memoryCsrfToken = null;
  }
}

export function getCsrfToken(): string | undefined {
  if (memoryCsrfToken) return memoryCsrfToken;
  if (typeof document === 'undefined' || !document.cookie) return undefined;

  for (const part of document.cookie.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === 'fortix_csrf' && val) {
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return undefined;
}

export function getActiveProjectId(): string | null {
  const stored = safeStorageGet('fortix_project_id');
  if (stored) {
    memoryProjectId = stored;
    return stored;
  }
  return memoryProjectId;
}

export function setActiveProjectId(id: string): void {
  memoryProjectId = id || null;
  if (id) {
    safeStorageSet('fortix_project_id', id);
  } else {
    safeStorageRemove('fortix_project_id');
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('fortix:project-switched', { detail: { projectId: id } }));
  }
}

export function clearActiveProjectId(): void {
  memoryProjectId = null;
  safeStorageRemove('fortix_project_id');
}

export function isAnalyticsOptedOut(): boolean {
  return safeStorageGet('fortix_analytics_opt_out') === 'true';
}

export function setAnalyticsOptOut(optOut: boolean): void {
  safeStorageSet('fortix_analytics_opt_out', optOut ? 'true' : 'false');
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const projectId = getActiveProjectId();
  const headers = new Headers(options.headers || {});
  const method = (options.method || 'GET').toUpperCase();

  if (memorySessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${memorySessionToken}`);
  }

  if (MUTATING_METHODS.has(method)) {
    const csrf = getCsrfToken();
    if (csrf && !headers.has('X-CSRF-Token')) {
      headers.set('X-CSRF-Token', csrf);
    }
    headers.set('X-Requested-With', 'FortiX-Control-Plane');
  }

  if (isAnalyticsOptedOut()) {
    headers.set('X-Fortix-Analytics-Opt-Out', 'true');
  }

  if (projectId) {
    headers.set('X-Fortix-Project-Id', projectId);
  }

  const urlObj = new URL(url, window.location.origin);

  // Automatically attach projectId to control plane endpoints if not already provided
  if (projectId && url.startsWith('/api/control/') && !urlObj.searchParams.has('projectId')) {
    if (!url.startsWith('/api/control/projects') || url.includes('/audit-logs')) {
      urlObj.searchParams.set('projectId', projectId);
    }
  }

  const targetUrl = url.startsWith('/') ? `${urlObj.pathname}${urlObj.search}` : urlObj.toString();

  const requestInit: RequestInit = {
    ...options,
    credentials: 'include',
    headers,
  };

  let response: Response;
  try {
    response = await fetch(targetUrl, requestInit);
  } catch (err: any) {
    if (
      method === 'GET' &&
      (err?.name === 'TypeError' || String(err?.message || '').toLowerCase().includes('failed to fetch'))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      response = await fetch(targetUrl, requestInit);
    } else {
      throw err;
    }
  }

  if (response.status === 401) {
    memoryCsrfToken = null;
    memorySessionToken = null;
    window.dispatchEvent(new CustomEvent('fortix:auth-unauthorized'));
  }

  return response;
}

export interface ParsedApiError {
  message: string;
  code: string;
  requestId?: string;
  recoveryHint?: string;
}

export async function parseApiErrorResponse(
  res: Response,
  fallbackMessage = 'Request could not be completed.'
): Promise<ParsedApiError> {
  const reqIdHeader = res.headers.get('X-Request-ID') || undefined;
  try {
    const body = await res.json();
    return {
      message: typeof body?.error === 'string' ? body.error : fallbackMessage,
      code: typeof body?.code === 'string' ? body.code : `HTTP_${res.status}`,
      requestId: body?.requestId || reqIdHeader,
      recoveryHint: typeof body?.recoveryHint === 'string' ? body.recoveryHint : undefined,
    };
  } catch {
    return {
      message: fallbackMessage,
      code: `HTTP_${res.status}`,
      requestId: reqIdHeader,
    };
  }
}

export function trackProductEvent(event: string, workspaceMode: 'demo' | 'standard' = 'standard'): void {
  if (isAnalyticsOptedOut()) return;
  fetchWithAuth('/api/control/system/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, workspaceMode }),
  }).catch(() => {
    // Non-blocking first-party aggregate event
  });
}
