import React, { useState } from 'react';
import { X } from 'lucide-react';

export function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('admin@fortix.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('fortix_token', data.token);
      onLogin();
    } else {
      setError('Invalid credentials. Please verify your email and password.');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    }
  };

  const handleForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail) return;
    setResetMessage(`A password reset link has been sent to ${resetEmail}.`);
    setTimeout(() => {
      setIsForgotOpen(false);
      setResetMessage('');
      setResetEmail('');
    }, 3000);
  };

  return (
    <div className="flex h-screen w-full items-center justify-center bg-base text-strong">
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-10px); }
          80% { transform: translateX(10px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
      
      <form onSubmit={handleLogin} className={`flex flex-col gap-4 w-80 bg-elevated p-8 rounded border border-subtle ${isShaking ? 'animate-shake' : ''}`}>
        <h2 className="text-xl font-bold text-primary mb-4">FortiX Login</h2>
        {error && <div className="text-red-500 text-sm bg-red-500/10 border border-red-500/20 p-2 rounded text-center font-medium">{error}</div>}
        <input className="bg-black border border-subtle p-2 rounded text-sm focus:outline-none focus:border-primary transition-colors" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" required />
        <input className="bg-black border border-subtle p-2 rounded text-sm focus:outline-none focus:border-primary transition-colors" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required />
        <button type="submit" className="bg-primary hover:bg-orange-500 transition-colors text-black font-bold py-2 rounded mt-2">Login</button>
        <button type="button" onClick={() => setIsForgotOpen(true)} className="text-xs text-muted hover:text-strong transition-colors text-center mt-2">
          Forgot Password?
        </button>
      </form>

      {/* Forgot Password Modal */}
      {isForgotOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-base/80 backdrop-blur-sm">
          <div className="bg-elevated border border-subtle p-6 rounded-lg w-80 relative shadow-2xl">
            <button type="button" onClick={() => setIsForgotOpen(false)} className="absolute top-4 right-4 text-muted hover:text-strong transition-colors">
              <X size={18} />
            </button>
            <h3 className="text-lg font-bold text-strong mb-4">Reset Password</h3>
            {resetMessage ? (
              <div className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 p-3 rounded text-center">
                {resetMessage}
              </div>
            ) : (
              <form onSubmit={handleForgotSubmit} className="flex flex-col gap-4">
                <p className="text-xs text-muted">Enter your email address and we'll send you a link to reset your password.</p>
                <input
                  className="bg-base border border-subtle text-sm p-2.5 rounded focus:outline-none focus:border-primary transition-colors"
                  type="email"
                  value={resetEmail}
                  onChange={e => setResetEmail(e.target.value)}
                  placeholder="Your email address"
                  required
                />
                <button type="submit" className="bg-primary hover:bg-orange-500 transition-colors text-inverted font-bold py-2.5 rounded uppercase text-xs tracking-widest">
                  Send Reset Link
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
