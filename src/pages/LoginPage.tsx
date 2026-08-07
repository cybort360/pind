import { ArrowLeft, LogIn, Mail, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../state';
import { FieldError } from '../components/FieldError';

export function LoginPage() {
  const { login, enterDemo, auth, notify } = useApp();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter the email used when the workspace was created.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await login(email, password);
      notify('Welcome back', 'You are signed in to your workspace.');
      navigate('/app', { replace: true });
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'Could not sign in' });
    } finally {
      setSaving(false);
    }
  }

  async function enterDemoMode() {
    setDemoBusy(true);
    try {
      const state = await enterDemo();
      notify('Demo workspace open', `${state.workspace.name} is ready to explore.`);
      navigate('/app', { replace: true });
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'Could not open the demo' });
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <div className="boot-screen auth-screen">
      <div className="auth-card">
        <div className="auth-card__brand"><span className="brand-mark brand-mark--large">P</span><div><h1>Sign in to your workspace</h1><p>Only the owner of this install can open the studio. Review links shared with clients work without an account.</p></div></div>

        <form className="form-stack" onSubmit={submit} noValidate>
          <label className="field"><span><Mail size={14} /> Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@studio.com" autoComplete="username" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'login-email-error' : undefined} /><FieldError id="login-email-error" message={errors.email} /></label>
          <label className="field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" autoComplete="current-password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'login-password-error' : undefined} /><FieldError id="login-password-error" message={errors.password} /></label>

          {errors.form && <div className="field-error" role="alert">{errors.form}</div>}

          <button className="button button--primary" disabled={saving}><LogIn size={15} /> {saving ? 'Signing in…' : 'Sign in'}</button>
        </form>

        <div className="auth-card__actions">
          <button type="button" className="button button--outline" onClick={() => void enterDemoMode()} disabled={demoBusy}><Sparkles size={16} /> {demoBusy ? 'Opening…' : 'Explore the demo instead'}</button>
          <Link to="/" className="button button--ghost"><ArrowLeft size={15} /> Back home</Link>
        </div>

        <div className="auth-card__foot">No account yet? {auth.configured ? <span>Only the owner can create one.</span> : <Link to="/setup">Create the workspace</Link>}</div>
      </div>
    </div>
  );
}
