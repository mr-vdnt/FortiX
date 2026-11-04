import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { setCsrfToken, setMemorySessionToken } from '../lib/api.js';

interface VerifyNavigationState {
  challengeId?: string;
  channel?: 'EMAIL' | 'SMS';
  destinationMasked?: string;
  expiresInSeconds?: number;
  resendCooldownSeconds?: number;
  genericMessage?: string;
  devOtpCode?: string;
}

interface ResetNavigationState {
  resetAuthorization?: string;
  expiresInSeconds?: number;
}

export function PasswordRecoveryPage({
  step,
  onSessionsRevoked,
}: {
  step: 'forgot' | 'verify' | 'reset';
  onSessionsRevoked?: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  // Step 1: /forgot-password state
  const [identifier, setIdentifier] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);

  // Step 2: /verify-reset state (in-memory router state only — never URL query or localStorage)
  const navVerify = (location.state || {}) as VerifyNavigationState;
  const [challengeId, setChallengeId] = useState<string>(navVerify.challengeId || '');
  const [destinationMasked, setDestinationMasked] = useState<string>(navVerify.destinationMasked || '');
  const [genericNotice, setGenericNotice] = useState<string>(
    navVerify.genericMessage ||
      "If an account matches the information provided, we'll send verification instructions."
  );
  const [devOtpHint, setDevOtpHint] = useState<string>(navVerify.devOtpCode || '');
  const [otpInput, setOtpInput] = useState('');
  const [resendCooldown, setResendCooldown] = useState<number>(navVerify.resendCooldownSeconds ?? 60);
  const [verifyError, setVerifyError] = useState('');
  const [verifyStatusMsg, setVerifyStatusMsg] = useState('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);

  // Step 3: /reset-password state (single-use resetAuthorization held strictly in React memory)
  const navReset = (location.state || {}) as ResetNavigationState;
  const [resetAuthorization, setResetAuthorization] = useState<string>(navReset.resetAuthorization || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetError, setResetError] = useState('');
  const [isResetSubmitting, setIsResetSubmitting] = useState(false);
  const [resetCompleted, setResetCompleted] = useState(false);

  useEffect(() => {
    if (step === 'verify') {
      const nextState = (location.state || {}) as VerifyNavigationState;
      if (nextState.challengeId) setChallengeId(nextState.challengeId);
      if (nextState.destinationMasked) setDestinationMasked(nextState.destinationMasked);
      if (nextState.genericMessage) setGenericNotice(nextState.genericMessage);
      setDevOtpHint(nextState.devOtpCode || '');
      if (typeof nextState.resendCooldownSeconds === 'number') {
        setResendCooldown(nextState.resendCooldownSeconds);
      }
    } else if (step === 'reset') {
      const nextReset = (location.state || {}) as ResetNavigationState;
      if (nextReset.resetAuthorization) {
        setResetAuthorization(nextReset.resetAuthorization);
      }
    }
  }, [step, location.state]);

  useEffect(() => {
    if (step !== 'verify' || resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step, resendCooldown]);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    const trimmed = identifier.trim();
    if (!trimmed) {
      setForgotError('Enter the email address or phone number associated with your FortiX account.');
      return;
    }

    setIsForgotSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setForgotError(data.error || 'Unable to process recovery request. Please try again.');
        return;
      }

      navigate('/verify-reset', {
        state: {
          challengeId: data.challengeId,
          channel: data.channel,
          destinationMasked: data.destinationMasked,
          expiresInSeconds: data.expiresInSeconds,
          resendCooldownSeconds: data.resendCooldownSeconds ?? 60,
          genericMessage:
            data.message ||
            "If an account matches the information provided, we'll send verification instructions.",
          devOtpCode: data.devOtpCode,
        } satisfies VerifyNavigationState,
      });
    } catch {
      setForgotError('Unable to reach the FortiX authentication service. Please try again.');
    } finally {
      setIsForgotSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!challengeId || resendCooldown > 0 || isResendingOtp) return;
    setVerifyError('');
    setVerifyStatusMsg('');
    setIsResendingOtp(true);

    try {
      const res = await fetch('/api/auth/resend-reset-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (typeof data.retryAfterSeconds === 'number') {
          setResendCooldown(data.retryAfterSeconds);
        }
        setVerifyError(data.error || 'Please wait before requesting another verification code.');
        return;
      }

      setResendCooldown(data.resendCooldownSeconds ?? 60);
      setDevOtpHint(data.devOtpCode || '');
      setVerifyStatusMsg(
        data.message || "If an account matches the information provided, we'll send verification instructions."
      );
    } catch {
      setVerifyError('Network error while resending verification code.');
    } finally {
      setIsResendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setVerifyError('');
    setVerifyStatusMsg('');

    const normalizedOtp = otpInput.replace(/\s+/g, '');
    if (!/^\d{6}$/.test(normalizedOtp)) {
      setVerifyError('Enter the 6-digit verification code.');
      return;
    }

    setIsVerifyingOtp(true);
    try {
      const res = await fetch('/api/auth/verify-reset-otp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeId,
          otp: normalizedOtp,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.resetAuthorization) {
        const attemptsHint =
          typeof data.remainingAttempts === 'number' && data.remainingAttempts > 0
            ? ` (${data.remainingAttempts} ${data.remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining)`
            : '';
        setVerifyError((data.error || 'Invalid or expired verification code.') + attemptsHint);
        return;
      }

      navigate('/reset-password', {
        replace: true,
        state: {
          resetAuthorization: data.resetAuthorization,
          expiresInSeconds: data.expiresInSeconds,
        } satisfies ResetNavigationState,
      });
    } catch {
      setVerifyError('Unable to verify code right now. Please try again.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');

    if (newPassword.length < 8) {
      setResetError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setResetError('New password and confirmation password do not match.');
      return;
    }

    setIsResetSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resetAuthorization,
          newPassword,
          confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResetError(data.error || 'Invalid or expired password reset authorization.');
        return;
      }

      // Immediately clear ephemeral reset authorization and tear down any local client session state
      setResetAuthorization('');
      setNewPassword('');
      setConfirmPassword('');
      setCsrfToken(null);
      setMemorySessionToken(null);
      onSessionsRevoked?.();
      setResetCompleted(true);
    } catch {
      setResetError('Network error while updating password.');
    } finally {
      setIsResetSubmitting(false);
    }
  };

  return (
    <div className="dark min-h-screen w-full flex items-start sm:items-center justify-center bg-[#090b10] text-zinc-100 px-4 py-6 sm:py-10 relative overflow-x-hidden overflow-y-auto">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(242,125,38,0.12),transparent_45%),radial-gradient(circle_at_80%_75%,rgba(30,64,175,0.14),transparent_50%)]"
      />

      <div className="relative z-10 w-full max-w-md my-auto">
        {/* FortiX Brand Header */}
        <div className="mb-6 flex items-center justify-between">
          <Link to="/login" className="flex items-center gap-3 group">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-zinc-950 font-bold text-base shadow-lg">
              FX
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-white leading-none">FortiX</div>
              <div className="text-[11px] font-semibold tracking-wider uppercase text-zinc-400 mt-1">
                API SECURITY &amp; RESILIENCE PLATFORM
              </div>
            </div>
          </Link>
        </div>

        <div className="rounded-2xl bg-[#131622] border border-white/15 shadow-2xl p-6 sm:p-8">
          {/* STEP 1: /forgot-password */}
          {step === 'forgot' && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Reset your password</h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
                Enter the email address or phone number associated with your FortiX account.
              </p>

              {forgotError && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-2.5 rounded-xl bg-red-500/12 border border-red-500/35 px-3.5 py-3 text-xs text-red-300 leading-relaxed"
                >
                  <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                  <span>{forgotError}</span>
                </div>
              )}

              <form onSubmit={handleRequestOtp} className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="recovery-identifier"
                    className="block text-xs font-semibold text-zinc-200 mb-1.5"
                  >
                    Email address or phone number
                  </label>
                  <div className="relative">
                    <Mail
                      size={15}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
                    />
                    <input
                      id="recovery-identifier"
                      type="text"
                      autoComplete="username"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="Enter your email or phone number"
                      required
                      autoFocus
                      className="w-full rounded-xl bg-[#0a0c13] border border-white/20 pl-10 pr-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-colors"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isForgotSubmitting}
                  className="w-full rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-60 text-zinc-950 font-semibold text-sm py-2.5 px-4 transition-colors flex items-center justify-center gap-2 shadow-md"
                >
                  <span>{isForgotSubmitting ? 'Sending instructions...' : 'Continue'}</span>
                  {!isForgotSubmitting && <ArrowRight size={15} />}
                </button>
              </form>

              <p className="mt-4 text-xs text-zinc-400 leading-relaxed">
                If an account matches the information provided, we&apos;ll send verification instructions.
              </p>

              <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-zinc-300 hover:text-white font-medium transition-colors"
                >
                  <ArrowLeft size={14} />
                  <span>Back to sign in</span>
                </Link>
              </div>
            </div>
          )}

          {/* STEP 2: /verify-reset */}
          {step === 'verify' && (
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Verify your identity</h1>
              <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">{genericNotice}</p>

              {!challengeId ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs text-amber-200 leading-relaxed">
                    No active verification challenge was found in this browser tab. Start a new password reset request to receive a 6-digit code.
                  </div>
                  <Link
                    to="/forgot-password"
                    className="w-full rounded-xl bg-primary hover:bg-primary-hover text-zinc-950 font-semibold text-sm py-2.5 px-4 transition-colors flex items-center justify-center gap-2"
                  >
                    <span>Reset your password</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>
              ) : (
                <>
                  {destinationMasked && (
                    <div className="mt-4 rounded-xl bg-[#0a0c13] border border-white/10 px-3.5 py-2.5 text-xs text-zinc-300 flex items-center justify-between">
                      <span className="text-zinc-400">Target destination</span>
                      <span className="font-mono text-zinc-100">{destinationMasked}</span>
                    </div>
                  )}

                  {devOtpHint && (
                    <div className="mt-4 rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 space-y-2 text-xs">
                      <div className="font-semibold text-amber-300">
                        Local Dev Outbox (non-production only)
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-base tracking-widest font-bold text-white">
                          {devOtpHint}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOtpInput(devOtpHint)}
                          className="px-2.5 py-1 rounded-lg bg-[#0a0c13] border border-white/15 text-amber-300 hover:text-white text-[11px] font-medium transition-colors"
                        >
                          Fill code
                        </button>
                      </div>
                    </div>
                  )}

                  {verifyStatusMsg && (
                    <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-emerald-500/12 border border-emerald-500/30 px-3.5 py-3 text-xs text-emerald-300 leading-relaxed">
                      <CheckCircle2 size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                      <span>{verifyStatusMsg}</span>
                    </div>
                  )}

                  {verifyError && (
                    <div
                      role="alert"
                      className="mt-4 flex items-start gap-2.5 rounded-xl bg-red-500/12 border border-red-500/35 px-3.5 py-3 text-xs text-red-300 leading-relaxed"
                    >
                      <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                      <span>{verifyError}</span>
                    </div>
                  )}

                  <form onSubmit={handleVerifyOtp} className="mt-5 space-y-4">
                    <div>
                      <label
                        htmlFor="recovery-otp"
                        className="block text-xs font-semibold text-zinc-200 mb-1.5"
                      >
                        6-digit verification code
                      </label>
                      <div className="relative">
                        <KeyRound
                          size={15}
                          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
                        />
                        <input
                          id="recovery-otp"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={otpInput}
                          onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          placeholder="000000"
                          required
                          autoFocus
                          className="w-full rounded-xl bg-[#0a0c13] border border-white/20 pl-10 pr-3.5 py-2.5 text-base font-mono tracking-[0.3em] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-colors"
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-zinc-500">
                        Verification codes expire after 10 minutes and lock after 5 incorrect attempts.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={isVerifyingOtp || otpInput.length !== 6}
                      className="w-full rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-60 text-zinc-950 font-semibold text-sm py-2.5 px-4 transition-colors flex items-center justify-center gap-2 shadow-md"
                    >
                      <span>{isVerifyingOtp ? 'Verifying...' : 'Verify code'}</span>
                      {!isVerifyingOtp && <ArrowRight size={15} />}
                    </button>
                  </form>

                  <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between gap-2 text-xs">
                    <Link
                      to="/forgot-password"
                      className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <ArrowLeft size={14} />
                      <span>Change destination</span>
                    </Link>

                    <button
                      type="button"
                      onClick={() => void handleResendOtp()}
                      disabled={resendCooldown > 0 || isResendingOtp}
                      className="inline-flex items-center gap-1.5 text-primary hover:underline disabled:text-zinc-500 disabled:no-underline font-semibold transition-colors"
                    >
                      <RefreshCw size={13} className={isResendingOtp ? 'animate-spin' : ''} />
                      <span>
                        {resendCooldown > 0
                          ? `Resend in ${resendCooldown}s`
                          : isResendingOtp
                            ? 'Sending...'
                            : 'Resend code'}
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: /reset-password */}
          {step === 'reset' && (
            <div>
              {resetCompleted ? (
                <div className="space-y-5">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <ShieldCheck size={22} />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight text-white">Password updated</h1>
                    <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
                      Your FortiX account password has been updated and all active sessions and refresh tokens have been revoked. Sign in with your new password to continue.
                    </p>
                  </div>
                  <Link
                    to="/login"
                    className="w-full rounded-xl bg-primary hover:bg-primary-hover text-zinc-950 font-semibold text-sm py-2.5 px-4 transition-colors flex items-center justify-center gap-2 shadow-md"
                  >
                    <span>Sign in</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>
              ) : !resetAuthorization ? (
                <div className="space-y-4">
                  <h1 className="text-2xl font-bold tracking-tight text-white">Create a new password</h1>
                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 text-xs text-amber-200 leading-relaxed">
                    Your password-reset authorization is missing or has expired. Complete identity verification first to set a new password.
                  </div>
                  <Link
                    to="/forgot-password"
                    className="w-full rounded-xl bg-primary hover:bg-primary-hover text-zinc-950 font-semibold text-sm py-2.5 px-4 transition-colors flex items-center justify-center gap-2"
                  >
                    <span>Start password reset</span>
                    <ArrowRight size={15} />
                  </Link>
                </div>
              ) : (
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-white">Create a new password</h1>
                  <p className="text-xs sm:text-sm text-zinc-400 mt-2 leading-relaxed">
                    Choose a strong password for your FortiX account.
                  </p>

                  {resetError && (
                    <div
                      role="alert"
                      className="mt-5 flex items-start gap-2.5 rounded-xl bg-red-500/12 border border-red-500/35 px-3.5 py-3 text-xs text-red-300 leading-relaxed"
                    >
                      <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                      <span>{resetError}</span>
                    </div>
                  )}

                  <form onSubmit={handleResetPassword} className="mt-6 space-y-4">
                    <div>
                      <label
                        htmlFor="reset-new-password"
                        className="block text-xs font-semibold text-zinc-200 mb-1.5"
                      >
                        New password
                      </label>
                      <div className="relative">
                        <Lock
                          size={15}
                          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
                        />
                        <input
                          id="reset-new-password"
                          type={showNewPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          minLength={8}
                          maxLength={128}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter new password"
                          required
                          autoFocus
                          className="w-full rounded-xl bg-[#0a0c13] border border-white/20 pl-10 pr-10 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNewPassword((prev) => !prev)}
                          aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-100 p-1 rounded-md transition-colors"
                        >
                          {showNewPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="reset-confirm-password"
                        className="block text-xs font-semibold text-zinc-200 mb-1.5"
                      >
                        Confirm new password
                      </label>
                      <div className="relative">
                        <Lock
                          size={15}
                          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
                        />
                        <input
                          id="reset-confirm-password"
                          type={showConfirmPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          minLength={8}
                          maxLength={128}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Confirm new password"
                          required
                          className="w-full rounded-xl bg-[#0a0c13] border border-white/20 pl-10 pr-10 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((prev) => !prev)}
                          aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-100 p-1 rounded-md transition-colors"
                        >
                          {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isResetSubmitting}
                      className="w-full rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-60 text-zinc-950 font-semibold text-sm py-2.5 px-4 transition-colors flex items-center justify-center gap-2 shadow-md"
                    >
                      <span>{isResetSubmitting ? 'Updating password...' : 'Update password'}</span>
                      {!isResetSubmitting && <ArrowRight size={15} />}
                    </button>
                  </form>

                  <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
                    <Link
                      to="/login"
                      className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      <ArrowLeft size={14} />
                      <span>Cancel and return to sign in</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
