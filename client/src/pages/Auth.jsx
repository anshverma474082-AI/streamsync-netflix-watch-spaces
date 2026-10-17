import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Auth() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', displayName: '', role: 'host' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form);
      navigate('/');
    } catch (err) {
      setError(err.details?.map((d) => d.msg).join(', ') ?? err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="logo">StreamSync</h1>
        <p className="tagline">AI-driven social watch spaces</p>
        <div className="tabs">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>Sign in</button>
          <button className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>Register</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input type="password" placeholder="Password (min 8 chars)" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {mode === 'register' && (
            <>
              <input placeholder="Display name" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="host">I want to host watch parties</option>
                <option value="viewer">Viewer</option>
              </select>
            </>
          )}
          {error && <div className="form-error">{error}</div>}
          <button className="btn primary" disabled={busy}>{busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <div className="demo-creds">
          <p>Demo accounts (seeded):</p>
          <code>host@streamsync.dev / streamsync-host-1</code>
          <code>ana@streamsync.dev / streamsync-fan-1</code>
          <code>ravi@streamsync.dev / streamsync-fan-1 · admin@streamsync.dev / streamsync-admin-1</code>
        </div>
      </div>
    </div>
  );
}
