import { Login } from './components/Login.js';
import React from 'react';
import { BrowserRouter, Routes, Route, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Shield,
  Server,
  Play,
  Settings as SettingsIcon,
  ShieldAlert,
  BarChart,
  Menu,
  X,
  LogOut,
  AlertTriangle,
  Moon,
  Sun,
  Globe,
  MailCheck,
  CheckCircle2,
} from 'lucide-react';
import Dashboard from './pages/Dashboard.js';
import APIs from './pages/APIs.js';
import PublicApiDirectory from './pages/PublicApiDirectory.js';
import Experiments from './pages/Experiments.js';
import Security from './pages/Security.js';
import Resilience from './pages/Resilience.js';
import Threats from './pages/Threats.js';
import Topology from './pages/Topology.js';
import Settings from './pages/Settings.js';
import Verifications from './pages/Verifications.js';
import NotFound from './pages/NotFound.js';
import { PrivacyPolicyPage, TermsOfUsePage } from './pages/LegalPages.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { CommandPalette } from './components/CommandPalette.js';
import { SocketProvider } from './context/SocketContext.js';
import { ProjectProvider, useProject } from './context/ProjectContext.js';
import { ProjectSwitcher } from './components/ProjectSwitcher.js';
import { fetchWithAuth, getCsrfToken, setCsrfToken } from './lib/api.js';

export interface CurrentOperatorUser {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
}

export interface HealthAndStorageState {
  db: string;
  redis: string;
  deploymentMode: string;
  postgresStorageMode: string;
  redisStorageMode: string;
  persistenceVerified: boolean;
}

function Layout({
  healthStatus,
  currentUser,
  onUserVerified,
  theme,
  setTheme,
  onLogout,
}: {
  healthStatus: HealthAndStorageState | null;
  currentUser: CurrentOperatorUser | null;
  onUserVerified: () => void;
  theme: string;
  setTheme: React.Dispatch<React.SetStateAction<string>>;
  onLogout: () => Promise<void>;
}) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const navigate = useNavigate();
  const location = useLocation();

  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = React.useState(false);

  // Inline Email Verification Bar state
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [verifyTokenInput, setVerifyTokenInput] = React.useState('');
  const [devVerifyToken, setDevVerifyToken] = React.useState('');
  const [verifyBusy, setVerifyBusy] = React.useState(false);
  const [verifyFeedback, setVerifyFeedback] = React.useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const isDegraded = healthStatus && (healthStatus.db === 'error' || healthStatus.redis === 'error');
  const isEphemeralSandbox = healthStatus && !healthStatus.persistenceVerified;

  const handleDispatchVerification = async () => {
    setVerifyBusy(true);
    setVerifyFeedback(null);
    try {
      const res = await fetchWithAuth('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.devVerificationToken) {
          setDevVerifyToken(data.devVerificationToken);
          setVerifyTokenInput(data.devVerificationToken);
        }
        setVerifyOpen(true);
        setVerifyFeedback({ type: 'ok', text: data.message || 'Verification token generated.' });
      } else {
        setVerifyFeedback({ type: 'err', text: data.error || 'Unable to generate verification token.' });
      }
    } catch {
      setVerifyFeedback({ type: 'err', text: 'Network error while requesting verification token.' });
    } finally {
      setVerifyBusy(false);
    }
  };

  const handleConfirmVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyTokenInput.trim()) return;
    setVerifyBusy(true);
    setVerifyFeedback(null);
    try {
      const res = await fetchWithAuth('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyTokenInput.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setVerifyOpen(false);
        setVerifyTokenInput('');
        setDevVerifyToken('');
        onUserVerified();
      } else {
        setVerifyFeedback({ type: 'err', text: data.error || 'Invalid or expired verification token.' });
      }
    } catch {
      setVerifyFeedback({ type: 'err', text: 'Network error while verifying email.' });
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-transparent text-base-text font-sans overflow-hidden p-0 sm:p-3 md:p-4 lg:p-6">
      <div className="flex flex-col h-full w-full bg-base rounded-none sm:rounded-2xl md:rounded-3xl border-0 sm:border border-subtle overflow-hidden shadow-glass relative isolate">
        <CommandPalette isOpen={isPaletteOpen} setIsOpen={setIsPaletteOpen} toggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)} />

        {/* Health Banner */}
        {isDegraded && (
          <div className="bg-red-900/40 text-red-400 text-xs font-semibold px-4 py-2 text-center border-b border-red-500/50 flex items-center justify-center gap-2 shrink-0 z-50">
            <AlertTriangle size={15} />
            <span>
              Subsystem degraded: {healthStatus.db === 'error' ? 'PostgreSQL' : ''}{' '}
              {healthStatus.db === 'error' && healthStatus.redis === 'error' ? 'and' : ''}{' '}
              {healthStatus.redis === 'error' ? 'Redis' : ''}{' '}
              {healthStatus.db === 'error' && healthStatus.redis === 'error' ? 'are' : 'is'} unreachable.
            </span>
          </div>
        )}

        {/* Unverified Operator Email Banner */}
        {currentUser && !currentUser.emailVerified && (
          <div className="bg-amber-500/10 border-b border-amber-500/25 px-4 py-2 text-xs text-amber-300 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <MailCheck size={14} className="text-amber-400 shrink-0" />
              <span className="truncate">
                Email <strong className="font-mono">{currentUser.email}</strong> is unverified. Verify ownership to complete account hardening.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {!verifyOpen ? (
                <button
                  type="button"
                  disabled={verifyBusy}
                  onClick={handleDispatchVerification}
                  className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-semibold transition-colors whitespace-nowrap"
                >
                  {verifyBusy ? 'Sending...' : 'Send Verification Token'}
                </button>
              ) : (
                <form onSubmit={handleConfirmVerification} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={verifyTokenInput}
                    onChange={(e) => setVerifyTokenInput(e.target.value)}
                    placeholder="Paste 64-char verification token"
                    className="w-48 sm:w-60 px-2.5 py-1 rounded-lg bg-[#0d1017] border border-amber-500/40 text-zinc-100 font-mono text-[11px] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={verifyBusy}
                    className="px-3 py-1 rounded-lg bg-primary text-inverted font-semibold whitespace-nowrap"
                  >
                    {verifyBusy ? 'Verifying...' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerifyOpen(false)}
                    className="px-2 py-1 text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
            {verifyFeedback && (
              <div className={`w-full text-[11px] ${verifyFeedback.type === 'err' ? 'text-red-300' : 'text-emerald-300'}`}>
                {verifyFeedback.text}
                {devVerifyToken ? ' (Dev sandbox token prefilled above)' : ''}
              </div>
            )}
          </div>
        )}

        {/* Header */}
        <header className="flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 border-b border-subtle bg-surface shrink-0 gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 md:gap-4 min-w-0 shrink">
            <button
              className="md:hidden text-muted hover:text-strong transition shrink-0 p-1"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              aria-label="Toggle navigation menu"
            >
              {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="flex items-center justify-center w-8 h-8 md:w-9 md:h-9 rounded-xl bg-primary text-inverted font-bold text-base shrink-0">
              FX
            </div>
            <div className="hidden lg:block shrink-0">
              <h1 className="text-base font-bold tracking-tight text-strong leading-none whitespace-nowrap">
                FortiX Gateway
              </h1>
            </div>
            <div className="hidden sm:block ml-1 sm:ml-2 pl-2 sm:pl-3 border-l border-subtle min-w-0 max-w-[180px] md:max-w-[220px] lg:max-w-[260px]">
              <ProjectSwitcher />
            </div>
          </div>

          <div className="flex-1 min-w-[90px] max-w-xs sm:max-w-sm md:max-w-md mx-1 sm:mx-2 md:mx-4">
            <input
              type="text"
              placeholder="Search routes or Public APIs... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && searchQuery.trim() && location.pathname !== '/directory') {
                  navigate(`/directory?q=${encodeURIComponent(searchQuery.trim())}`);
                }
              }}
              className="w-full bg-white dark:bg-[#0d1017] border border-zinc-300 dark:border-white/20 text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl focus:outline-none focus:border-primary transition-colors truncate"
            />
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div className="sm:hidden">
              <ProjectSwitcher />
            </div>
            <div className="hidden lg:flex flex-col items-end mr-2 text-right">
              <span className="text-[11px] text-muted font-medium">
                {isDegraded ? 'Degraded' : isEphemeralSandbox ? 'Sandbox Storage' : 'Persistent Storage'}
              </span>
              <span className={`text-xs font-mono font-semibold tabular-nums ${isDegraded ? 'text-amber-400' : 'text-strong'}`}>
                {isDegraded ? 'CHECK HEALTH' : 'OPERATIONAL'}
              </span>
            </div>
            <div className="flex items-center pl-2 sm:pl-4 border-l border-subtle gap-2.5 sm:gap-3.5">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex items-center justify-center p-1.5 text-muted hover:text-strong transition-colors"
                title="Toggle Theme"
                aria-label="Toggle Theme"
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                onClick={onLogout}
                className="flex items-center justify-center p-1.5 text-muted hover:text-strong transition-colors"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex flex-1 overflow-hidden relative">
          {isSidebarOpen && (
            <div
              className="absolute inset-0 bg-base/80 z-40 md:hidden"
              onClick={() => setIsSidebarOpen(false)}
            />
          )}

          <aside
            className={`absolute z-50 md:relative h-full w-56 border-r border-subtle bg-surface md:bg-transparent p-4 flex flex-col gap-2 shrink-0 transition-transform duration-200 ${
              isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
            }`}
          >
            <div className="text-xs font-semibold text-muted mb-1 px-2">Workspace</div>
            <nav className="flex-1 space-y-1 overflow-y-auto">
              <NavItem to="/" icon={<Activity size={16} />} label="Dashboard" active={location.pathname === '/'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/apis" icon={<Server size={16} />} label="Protected APIs" active={location.pathname === '/apis'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/directory" icon={<Globe size={16} />} label="Public APIs" active={location.pathname === '/directory'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/security" icon={<Shield size={16} />} label="Security" active={location.pathname === '/security'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/experiments" icon={<Play size={16} />} label="Experiments" active={location.pathname === '/experiments'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/resilience" icon={<BarChart size={16} />} label="Resilience" active={location.pathname === '/resilience'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/threats" icon={<ShieldAlert size={16} />} label="Threats" active={location.pathname === '/threats'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/topology" icon={<Activity size={16} />} label="Topology" active={location.pathname === '/topology'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/verifications" icon={<CheckCircle2 size={16} />} label="Verifications" active={location.pathname === '/verifications'} onClick={() => setIsSidebarOpen(false)} />
              <NavItem to="/settings" icon={<SettingsIcon size={16} />} label="Settings" active={location.pathname === '/settings'} onClick={() => setIsSidebarOpen(false)} />
            </nav>
            <div className="mt-auto p-3 bg-elevated rounded-xl border border-subtle space-y-1">
              <div className="text-[11px] text-muted font-medium">Storage Mode</div>
              <div className="text-xs font-mono font-semibold text-strong truncate">
                {healthStatus?.persistenceVerified
                  ? 'Persistent Cloud'
                  : healthStatus?.postgresStorageMode === 'persistent'
                    ? 'Persistent DB · Mem Redis'
                    : 'Sandbox In-Memory'}
              </div>
              <div className="text-[11px] text-muted truncate">
                {currentUser ? `${currentUser.role.toLowerCase()} · ${currentUser.email}` : 'FortiX Control Plane'}
              </div>
            </div>
          </aside>

          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 p-4 sm:p-6 overflow-y-auto">
              <ErrorBoundary>
                <Outlet
                  context={{
                    searchQuery,
                    theme,
                    setTheme,
                    currentUser,
                    healthStatus,
                    refreshUser: onUserVerified,
                  }}
                />
              </ErrorBoundary>
            </div>
          </div>
        </main>

        <footer className="px-4 sm:px-6 py-2.5 border-t border-subtle bg-surface flex flex-wrap justify-between items-center gap-2 shrink-0">
          <div className="text-[11px] text-muted">© 2026 Faultline Labs · FortiX API Security &amp; Resilience Gateway</div>
          <div className="flex items-center gap-4 text-[11px] text-muted">
            <Link to="/privacy" className="hover:text-strong transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-strong transition-colors">Terms of Use</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}

function NavItem({ to, icon, label, active, onClick }: { to: string; icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-colors whitespace-nowrap ${
        active
          ? 'bg-primary text-inverted font-semibold'
          : 'text-muted hover:bg-hover hover:text-strong'
      }`}
    >
      <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>
      <span className="text-sm truncate">{label}</span>
    </Link>
  );
}

function SocketWrapper({ children }: { children: React.ReactNode }) {
  const { currentProject } = useProject();
  return <SocketProvider projectId={currentProject?.id}>{children}</SocketProvider>;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [currentUser, setCurrentUser] = React.useState<CurrentOperatorUser | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = React.useState(true);
  const [theme, setTheme] = React.useState(() => localStorage.getItem('fortix_theme_v2') || 'dark');
  const [healthStatus, setHealthStatus] = React.useState<HealthAndStorageState | null>(null);

  React.useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('fortix_theme_v2', theme);
    localStorage.setItem('fortix_theme', theme);
  }, [theme]);

  const loadAuthenticatedUser = React.useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.csrfToken) setCsrfToken(data.csrfToken);
        if (data.user) {
          setCurrentUser({
            id: data.user.id,
            email: data.user.email,
            role: data.user.role,
            emailVerified: Boolean(data.user.emailVerified),
          });
        }
        setIsAuthenticated(true);
        return;
      }
      setCurrentUser(null);
      setIsAuthenticated(false);
    } catch {
      setCurrentUser(null);
    } finally {
      setIsLoadingAuth(false);
    }
  }, []);

  React.useEffect(() => {
    try {
      localStorage.removeItem('fortix_token');
    } catch {}

    loadAuthenticatedUser();

    const handleUnauthorized = () => {
      setCsrfToken(null);
      setCurrentUser(null);
      setIsAuthenticated(false);
    };
    window.addEventListener('fortix:auth-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('fortix:auth-unauthorized', handleUnauthorized);
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
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          'X-Requested-With': 'FortiX-Control-Plane',
        },
      });
    } catch {
      // Proceed with client session teardown even on network interruption
    } finally {
      setCsrfToken(null);
      setCurrentUser(null);
      try {
        localStorage.removeItem('fortix_token');
        localStorage.removeItem('fortix_project_id');
      } catch {}
      setIsAuthenticated(false);
    }
  }, []);

  if (isLoadingAuth) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#090b10] text-zinc-400 font-sans text-sm">
        Loading FortiX Gateway...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsOfUsePage />} />
        {!isAuthenticated ? (
          <Route
            path="*"
            element={
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
                <Login onLogin={loadAuthenticatedUser} />
              </div>
            }
          />
        ) : (
          <Route
            path="/"
            element={
              <ProjectProvider>
                <SocketWrapper>
                  <Layout
                    healthStatus={healthStatus}
                    currentUser={currentUser}
                    onUserVerified={loadAuthenticatedUser}
                    theme={theme}
                    setTheme={setTheme}
                    onLogout={handleLogout}
                  />
                </SocketWrapper>
              </ProjectProvider>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="apis" element={<APIs />} />
            <Route path="directory" element={<PublicApiDirectory />} />
            <Route path="security" element={<Security />} />
            <Route path="experiments" element={<Experiments />} />
            <Route path="resilience" element={<Resilience />} />
            <Route path="threats" element={<Threats />} />
            <Route path="topology" element={<Topology />} />
            <Route path="verifications" element={<Verifications />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<NotFound isAuthenticated={true} />} />
          </Route>
        )}
      </Routes>
    </BrowserRouter>
  );
}
