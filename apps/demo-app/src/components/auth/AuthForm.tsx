import { useState } from 'react';
import { getApiBaseUrl } from '../../config';

interface AuthFormProps {
  onAuth: (email: string, token: string) => void;
}

export function AuthForm({ onAuth }: AuthFormProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const baseUrl = getApiBaseUrl();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const url = mode === 'register' ? `${baseUrl}/auth/register` : `${baseUrl}/auth/login`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? `${mode === 'register' ? 'Registration' : 'Login'} failed`);
        return;
      }
      const token: string = data.token;
      localStorage.setItem('syncra_token', token);
      onAuth(email, token);
    } catch {
      setError('Network error — is the API running?');
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-logo">Syncra</div>
        <p className="auth-subtitle">
          Field Service — {mode === 'login' ? 'sign in to your dashboard' : 'create your account'}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              className="form-input"
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="worker@company.com"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="auth-password">
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="auth-password"
                className="form-input"
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                className="auth-pw-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                  {showPassword ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.65rem' }}
            disabled={loading}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <p className="auth-toggle">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button onClick={toggleMode}>{mode === 'login' ? 'Register' : 'Sign in'}</button>
        </p>
      </div>
    </div>
  );
}
