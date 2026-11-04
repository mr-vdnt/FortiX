import React from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Login } from './components/Login.js';
import { PasswordRecoveryPage } from './pages/PasswordRecovery.js';
import { PrivacyPolicyPage, TermsOfUsePage } from './pages/LegalPages.js';
import {
  getCsrfToken,
  setCsrfToken,
  clearClientCsrfCookie,
  getMemorySessionToken,
  setMemorySessionToken,
  attemptSilentSessionRefresh,
  safeStorageGet,
  safeStorageSet,
  safeStorageRemove,
  clearActiveProjectId,
} from './lib/api.js';

import AuthenticatedWorkspace from './AuthenticatedWorkspace.js';

const EXPLICIT_AUTH_OR_PUBLIC_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/verify-reset',
  '/reset-password',
  '/privacy',
  '/terms',
]);

function isExplicitAuthOrPublicPath(): boolean {
  if (typeof window === 'undefined') return false;
  return EXPLICIT_AUTH_OR_PUBLIC_PATHS.has(window.location.pathname);
}

export interface CurrentOperatorUser {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
  phoneE164?: string | null;
  phoneVerified?: boolean;
}

export interface HealthAndStorageState {
  db: string;
  redis: string;
  deploymentMode: string;
  postgresStorageMode: string;
  redisStorageMode: string;
  persistenceVerified: boolean;
}

function AuthPageWrapper({
  initialMode,
  healthStatus,
  activeUser,
  onLogin,
  onLogout,
}: {
  initialMode: 'login' | 'register';
  healthStatus: HealthAndStorageState | null;
  activeUser: CurrentOperatorUser | null;
  onLogin: () => Promise<boolean>;
  onLogout: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLoginSuccess = async () => {
    const ok = await onLogin();
    if (ok && (location.pathname === '/login' || location.pathname === '/register')) {
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="dark min-h-screen w-full bg-[#090b10] text-zinc-100 relative">
      {healthStatus && (healthStatus.db === 'error' || healthStatus.redis === 'error') && (
        <div className="bg-red-950/90 text-red-300 text-xs md:text-sm font-semibold px-4 py-2.5 text-center border-b border-red-500/40 flex items-center justify-center gap-2 fixed top-0 inset-x-0 z-50 backdrop-blur-md">
          <AlertTriangle size={16} />
          <span>
            System degraded: {healthStatus.db === 'error' ? 'PostgreSQL' : ''}{' '}
            {healthStatus.db === 'error' && healthStatus.redis === 'error' ? 'and' : ''}{' '}
            {healthStatus.redis === 'error' ? 'Redis' : ''}{' '}
            {healthStatus.db === 'error' && healthStatus.redis === 'error' ? 'are' : 'is'} currently unavailable.
          </span>
        </div>
      )}
      <Login
        initialMode={initialMode}
        activeUser={activeUser}
        onContinueSession={activeUser ? () => navigate('/') : undefined}
        onSignOutCurrent={activeUser ? onLogout : undefined}
        onLogin={handleLoginSuccess}
      />
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [currentUser, setCurrentUser] = React.useState<CurrentOperatorUser | null>(null);
  // Render Login immediately on frame 0 when visiting an explicit auth route or when no session hint exists
  const [isLoadingAuth, setIsLoadingAuth] = React.useState(() =>
    !isExplicitAuthOrPublicPath() && Boolean(getCsrfToken() || getMemorySessionToken())
  );
  const [theme, setTheme] = React.useState(() => safeStorageGet('fortix_theme_v2') || 'dark');
  const [healthStatus, setHealthStatus] = React.useState<HealthAndStorageState | null>(null);

  React.useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    safeStorageSet('fortix_theme_v2', theme);
    safeStorageSet('fortix_theme', theme);
  }, [theme]);

  const loadAuthenticatedUser = React.useCallback(async (): Promise<boolean> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    try {
      const fetchMe = async () => {
        const memToken = getMemorySessionToken();
        return fetch('/api/auth/me', {
          credentials: 'include',
          headers: memToken ? { Authorization: `Bearer ${memToken}` } : undefined,
          signal: controller.signal,
        });
      };

      let res = await fetchMe();

      // If short-lived access cookie expired while a Remember-Me rotating refresh cookie is active, silently rotate once
      if (res.status === 401 && !getMemorySessionToken()) {
        const refreshed = await attemptSilentSessionRefresh();
        if (refreshed) {
          res = await fetchMe();
        }
      }

      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.user?.id === 'string' && typeof data.user?.email === 'string') {
          if (data.csrfToken) setCsrfToken(data.csrfToken);
          setCurrentUser({
            id: data.user.id,
            email: data.user.email,
            role: data.user.role,
            emailVerified: Boolean(data.user.emailVerified),
            phoneE164: data.user.phoneE164 ?? null,
            phoneVerified: Boolean(data.user.phoneVerified),
          });
          setIsAuthenticated(true);
          return true;
        }
      }

      clearClientCsrfCookie();
      setMemorySessionToken(null);
      setCurrentUser(null);
      setIsAuthenticated(false);
      return false;
    } catch {
      clearClientCsrfCookie();
      setCurrentUser(null);
      setIsAuthenticated(false);
      return false;
    } finally {
      clearTimeout(timeoutId);
      setIsLoadingAuth(false);
    }
  }, []);

  React.useEffect(() => {
    safeStorageRemove('fortix_token');

    let guardTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      setIsLoadingAuth(false);
    }, 2600);

    void loadAuthenticatedUser().finally(() => {
      if (guardTimer) {
        clearTimeout(guardTimer);
        guardTimer = null;
      }
    });

    const handleUnauthorized = () => {
      clearClientCsrfCookie();
      setMemorySessionToken(null);
      setCurrentUser(null);
      setIsAuthenticated(false);
    };
    window.addEventListener('fortix:auth-unauthorized', handleUnauthorized);
    return () => {
      if (guardTimer) clearTimeout(guardTimer);
      window.removeEventListener('fortix:auth-unauthorized', handleUnauthorized);
    };
  }, [loadAuthenticatedUser]);

  React.useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health');
        if (res.ok || res.status === 503) {
          const data = await res.json();
          const pgOk = data.postgres?.status === 'healthy' || data.db === 'healthy';
          const rdOk = data.redis?.status === 'healthy' || data.redis === 'healthy';
          setHealthStatus({
            db: pgOk ? 'healthy' : 'error',
            redis: rdOk ? 'healthy' : 'error',
            deploymentMode: data.deploymentMode || 'ephemeral-sandbox',
            postgresStorageMode: data.postgres?.storageMode || 'in-memory',
            redisStorageMode: data.redis?.storageMode || 'in-memory',
            persistenceVerified: Boolean(data.persistenceVerified),
          });
          return;
        }
        setHealthStatus({
          db: 'error',
          redis: 'error',
          deploymentMode: 'unhealthy',
          postgresStorageMode: 'unknown',
          redisStorageMode: 'unknown',
          persistenceVerified: false,
        });
      } catch {
        setHealthStatus({
          db: 'error',
          redis: 'error',
          deploymentMode: 'unhealthy',
          postgresStorageMode: 'unknown',
          redisStorageMode: 'unknown',
          persistenceVerified: false,
        });
      }
    };
    checkHealth();
    const intervalId = setInterval(checkHealth, 30000);
    return () => clearInterval(intervalId);
  }, []);

  const handleLogout = React.useCallback(async () => {
    try {
      const csrf = getCsrfToken();
      const memToken = getMemorySessionToken();
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          ...(memToken ? { Authorization: `Bearer ${memToken}` } : {}),
          'X-Requested-With': 'FortiX-Control-Plane',
        },
      });
    } catch {
      // Proceed with client session teardown even on network interruption
    } finally {
      clearClientCsrfCookie();
      setMemorySessionToken(null);
      clearActiveProjectId();
      safeStorageRemove('fortix_token');
      setCurrentUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  if (isLoadingAuth) {
    return (
      <div className="dark flex flex-col min-h-screen w-full items-center justify-center gap-4 bg-[#090b10] text-zinc-300 font-sans px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-zinc-950 font-bold text-sm">
            FX
          </div>
          <span className="text-sm text-zinc-300">Restoring FortiX session...</span>
        </div>
        <button
          type="button"
          onClick={() => {
            clearClientCsrfCookie();
            setIsLoadingAuth(false);
            if (typeof window !== 'undefined') {
              window.history.replaceState(null, '', '/login');
            }
          }}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Go directly to Sign in
        </button>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsOfUsePage />} />
        <Route
          path="/login"
          element={
            <AuthPageWrapper
              initialMode="login"
              healthStatus={healthStatus}
              activeUser={isAuthenticated ? currentUser : null}
              onLogin={loadAuthenticatedUser}
              onLogout={handleLogout}
            />
          }
        />
        <Route
          path="/register"
          element={
            <AuthPageWrapper
              initialMode="register"
              healthStatus={healthStatus}
              activeUser={isAuthenticated ? currentUser : null}
              onLogin={loadAuthenticatedUser}
              onLogout={handleLogout}
            />
          }
        />
        <Route
          path="/forgot-password"
          element={<PasswordRecoveryPage step="forgot" />}
        />
        <Route
          path="/verify-reset"
          element={<PasswordRecoveryPage step="verify" />}
        />
        <Route
          path="/reset-password"
          element={
            <PasswordRecoveryPage
              step="reset"
              onSessionsRevoked={() => {
                setCurrentUser(null);
                setIsAuthenticated(false);
              }}
            />
          }
        />
        {!isAuthenticated ? (
          <Route
            path="*"
            element={
              <AuthPageWrapper
                initialMode="login"
                healthStatus={healthStatus}
                activeUser={null}
                onLogin={loadAuthenticatedUser}
                onLogout={handleLogout}
              />
            }
          />
        ) : (
          <Route
            path="/*"
            element={
              <AuthenticatedWorkspace
                healthStatus={healthStatus}
                currentUser={currentUser}
                onUserVerified={() => void loadAuthenticatedUser()}
                theme={theme}
                setTheme={setTheme}
                onLogout={handleLogout}
              />
            }
          />
        )}
      </Routes>
    </BrowserRouter>
  );
}
