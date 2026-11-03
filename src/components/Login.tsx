import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  User,
  AlertCircle,
  ArrowRight,
  LogOut,
} from 'lucide-react';
import { setCsrfToken, setMemorySessionToken } from '../lib/api.js';

export function Login({
  onLogin,
  initialMode = 'login',
  activeUser,
  onContinueSession,
  onSignOutCurrent,
}: {
  onLogin: () => Promise<void> | void;
  initialMode?: 'login' | 'register';
  activeUser?: { email: string; role: string } | null;
  onContinueSession?: () => void;
  onSignOutCurrent?: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  React.useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);

  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 400);
  };

  const switchMode = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalizedIdentifier = identifier.trim();
    if (!normalizedIdentifier) {
      setError(
        mode === 'login'
          ? 'Please enter your email address or phone number.'
          : 'Please enter your email address.'
      );
      triggerShake();
      return;
    }

    if (mode === 'register' && password.length < 8) {
      setError('Password must be at least 8 characters long.');
      triggerShake();
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        const regRes = await fetch('/api/auth/register', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-Fortix-Client': 'browser' },
          body: JSON.stringify({
            email: normalizedIdentifier,
            password,
            name: name.trim() || undefined,
            phone: phone.trim() || undefined,
          }),
        });

        if (!regRes.ok) {
          const errPayload = await regRes.json().catch(() => ({}));
          if (regRes.status === 409) {
            setError(errPayload.error || 'An account with this email or phone already exists. Sign in instead.');
          } else if (regRes.status === 429) {
            setError(errPayload.error || 'Too many authentication attempts. Please wait a minute and retry.');
          } else {
            setError(errPayload.error || 'Unable to create account. Check your details and password (min 8 chars).');
          }
          triggerShake();
          return;
        }
      }

      // IMPORTANT: Never store passwords in localStorage, sessionStorage, or cookies.
      // Only `rememberMe` boolean is sent so the server issues rotating HttpOnly session/refresh cookies.
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Fortix-Client': 'browser' },
        body: JSON.stringify({
          identifier: normalizedIdentifier,
          password,
          rememberMe,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCsrfToken(data.csrfToken);
        setMemorySessionToken(null);

        // Verify whether the browser accepted the HttpOnly session cookie (blocked in some strict cross-origin iframes)
        let cookieAccepted = false;
        try {
          const meCheck = await fetch('/api/auth/me', { credentials: 'include' });
          const meContentType = meCheck.headers.get('content-type') || '';
          if (meCheck.ok && meContentType.includes('application/json')) {
            const meData = await meCheck.json().catch(() => null);
            cookieAccepted = Boolean(meData?.user?.id);
          }
        } catch {
          cookieAccepted = false;
        }

        if (!cookieAccepted) {
          const fallbackRes = await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-Fortix-Client': 'iframe-memory' },
            body: JSON.stringify({
              identifier: normalizedIdentifier,
              password,
              rememberMe: false,
            }),
          });
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json().catch(() => ({}));
            if (fallbackData.csrfToken) setCsrfToken(fallbackData.csrfToken);
            if (fallbackData.token) setMemorySessionToken(fallbackData.token);
          }
        }

        await onLogin();
      } else {
        const errPayload = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setError(errPayload.error || 'Too many login attempts. Please wait 1 minute before retrying.');
        } else if (res.status === 400) {
          setError(errPayload.error || 'Enter a valid email address or E.164 phone number.');
        } else {
          setError('Invalid credentials. Verify your email or verified phone number and password.');
        }
        triggerShake();
      }
    } catch {
      setError('Unable to reach the FortiX authentication service. Check server status and try again.');
      triggerShake();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#090b10] text-zinc-100 px-4 py-12 relative overflow-hidden">
      {/* Subtle Night Mode ambient radial backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(242,125,38,0.14),transparent_45%),radial-gradient(circle_at_80%_75%,rgba(30,64,175,0.16),transparent_50%)]"
      />

      <div className="relative z-10 w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
        {/* Left Column: Product Identity & Security Guarantees */}
        <div className="lg:col-span-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-zinc-950 font-bold text-lg shadow-lg">
              FX
            </div>
            <div>
              <div className="text-xl font-bold tracking-tight text-white leading-none">
                FortiX
              </div>
              <div className="text-[11px] font-semibold tracking-wider uppercase text-zinc-400 mt-1">
                API SECURITY &amp; RESILIENCE PLATFORM
              </div>
            </div>
          </div>

          <div className="space-y-3 max-w-xl">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
              Protect upstream APIs and verify resilience with stored evidence.
            </h1>
            <div className="text-sm sm:text-base text-zinc-300 leading-relaxed">
              Manage scoped API keys, per-route rate limits, active WAF threat inspection, and bounded fault-injection experiments from a single control plane.
            </div>
          </div>

          <div className="pt-2 border-t border-white/10 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <div className="font-semibold text-zinc-200">Scoped Key Auth</div>
              <div className="text-zinc-400 mt-0.5 leading-relaxed">
                Hashed credentials with instant distributed revocation.
              </div>
            </div>
            <div>
              <div className="font-semibold text-zinc-200">WAF &amp; SSRF Guard</div>
              <div className="text-zinc-400 mt-0.5 leading-relaxed">
                Per-route SQLi/XSS inspection and private-network blocking.
              </div>
            </div>
            <div>
              <div className="font-semibold text-zinc-200">Evidence Reports</div>
              <div className="text-zinc-400 mt-0.5 leading-relaxed">
                Latency, status distribution, and recovery telemetry.
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Solid Night Mode Auth Card */}
        <div className="lg:col-span-6 flex justify-center lg:justify-end">
          <div
            className={`w-full max-w-md rounded-2xl bg-[#131622] border border-white/15 shadow-2xl p-6 sm:p-8 ${
              isShaking ? 'animate-shake' : ''
            }`}
          >
            {activeUser && (
              <div className="mb-5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 text-xs text-emerald-200 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    Signed in as <strong className="font-mono text-white">{activeUser.email}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {onContinueSession && (
                    <button
                      type="button"
                      onClick={onContinueSession}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-primary text-zinc-950 font-semibold hover:bg-primary-hover transition-colors text-center"
                    >
                      Open Workspace
                    </button>
                  )}
                  {onSignOutCurrent && (
                    <button
                      type="button"
                      onClick={() => void onSignOutCurrent()}
                      className="inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-[#0a0c13] border border-white/15 text-zinc-200 hover:text-white transition-colors"
                    >
                      <LogOut size={13} />
                      <span>Sign Out</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mb-6">
              <div className="text-[11px] font-semibold tracking-wider uppercase text-primary mb-1">
                FortiX — API SECURITY &amp; RESILIENCE PLATFORM
              </div>
              <h2 className="text-2xl font-bold text-white tracking-tight">
                {mode === 'login' ? 'Welcome back' : 'Create an account'}
              </h2>
              <p className="text-xs text-zinc-400 mt-1">
                {mode === 'login'
                  ? 'Sign in with your email address or verified phone number.'
                  : 'Provision an isolated operator workspace with gateway security controls.'}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-xl bg-red-500/12 border border-red-500/35 px-3.5 py-3 text-xs text-red-300 leading-relaxed"
              >
                <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-semibold text-zinc-200 mb-1.5">
                    Operator Name <span className="text-zinc-500 font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    <input
                      id="auth-name"
                      type="text"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Alex Rivera"
                      className="w-full rounded-xl bg-[#0a0c13] border border-white/20 pl-10 pr-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-colors"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-identifier" className="block text-xs font-semibold text-zinc-200 mb-1.5">
                  {mode === 'login' ? 'Email address or phone number' : 'Email address'}
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    id="auth-identifier"
                    type={mode === 'login' ? 'text' : 'email'}
                    autoComplete={mode === 'login' ? 'username' : 'email'}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={
                      mode === 'login'
                        ? 'Enter your email or phone number'
                        : 'Enter your email address'
                    }
                    required
                    className="w-full rounded-xl bg-[#0a0c13] border border-white/20 pl-10 pr-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-colors"
                  />
                </div>
              </div>

              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-phone" className="block text-xs font-semibold text-zinc-200 mb-1.5">
                    Phone number <span className="text-zinc-500 font-normal">(optional, E.164)</span>
                  </label>
                  <div className="relative">
                    <Phone size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    <input
                      id="auth-phone"
                      type="tel"
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+919876543210"
                      className="w-full rounded-xl bg-[#0a0c13] border border-white/20 pl-10 pr-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-colors"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-password" className="block text-xs font-semibold text-zinc-200 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    id="auth-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'register' ? 'Minimum 8 characters' : 'Enter your password'}
                    required
                    minLength={mode === 'register' ? 8 : 1}
                    className="w-full rounded-xl bg-[#0a0c13] border border-white/20 pl-10 pr-10 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-100 p-1 rounded-md transition-colors"
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {mode === 'login' && (
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 rounded border-white/25 bg-[#0a0c13] text-primary focus:ring-primary/30"
                    />
                    <span>Remember me</span>
                  </label>

                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-zinc-300 hover:text-primary transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full mt-2 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-60 text-zinc-950 font-semibold text-sm py-2.5 px-4 transition-colors flex items-center justify-center gap-2 shadow-md"
              >
                <span>
                  {isSubmitting
                    ? mode === 'login'
                      ? 'Signing in...'
                      : 'Creating account...'
                    : mode === 'login'
                      ? 'Sign in'
                      : 'Create an account'}
                </span>
                {!isSubmitting && <ArrowRight size={15} />}
              </button>
            </form>

            <div className="mt-5 text-center text-xs text-zinc-400">
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="text-primary hover:underline font-semibold"
                  >
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="text-primary hover:underline font-semibold"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>

            <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-zinc-400">
              <span>Protected by rotating HttpOnly session &amp; CSRF guard</span>
              <div className="flex items-center gap-3">
                <Link to="/privacy" className="hover:text-zinc-200 transition-colors">
                  Privacy
                </Link>
                <Link to="/terms" className="hover:text-zinc-200 transition-colors">
                  Terms
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
