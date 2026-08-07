import { ArrowRight, Check, Eye, EyeOff, Lock, Mail, Palette, Paintbrush, Sparkles, User } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SetupInput } from '../state';
import { useApp } from '../state';
import { FieldError } from '../components/FieldError';

const accents = ['#2f5d50', '#8b4938', '#3e4f7a', '#6a4a73', '#80642f'];

export function SetupPage() {
  const { setupWorkspace, enterDemo, auth, notify } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState<SetupInput>({
    name: 'Northstar Creative',
    shortName: 'Northstar',
    logoText: 'N',
    accent: '#2f5d50',
    surface: 'paper',
    portalHeadline: 'Review the work. Leave clear feedback. Approve with confidence.',
    approvalDisclaimer: 'Approval confirms that this revision is accepted as final for the milestone shown above.',
    emailFromName: 'Maya at Northstar',
    ownerName: 'Maya Okeke',
    email: '',
    ownerPassword: '',
    loadDemoData: true,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (form.ownerName.trim().length < 2) next.ownerName = 'Add your name so the receipt and activity are attributed correctly.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = 'Enter a valid email address to sign in.';
    if (form.ownerPassword.length < 8) next.ownerPassword = 'Use at least 8 characters.';
    if (form.name.trim().length < 2) next.name = 'Give your workspace a name.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await setupWorkspace(form);
      notify('Workspace created', 'You are signed in and ready to start.');
      navigate('/app', { replace: true });
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : 'Could not create the workspace' });
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
        <div className="auth-card__brand"><span className="brand-mark brand-mark--large">{form.logoText || 'N'}</span><div><h1>Create your workspace</h1><p>This is the first run. Your studio identity carries across the dashboard, review links, and emails.</p></div></div>

        <form className="form-stack" onSubmit={submit} noValidate>
          <div className="form-grid">
            <label className="field"><span><Paintbrush size={14} /> Workspace name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Northstar Creative" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'setup-name-error' : undefined} /><FieldError id="setup-name-error" message={errors.name} /></label>
            <label className="field"><span>Short name</span><input value={form.shortName} onChange={(event) => setForm({ ...form, shortName: event.target.value })} placeholder="Northstar" /></label>
          </div>

          <div className="form-grid">
            <label className="field"><span>Logo letters</span><input maxLength={3} value={form.logoText} onChange={(event) => setForm({ ...form, logoText: event.target.value.toUpperCase() })} /></label>
            <label className="field"><span>Accent colour</span><div className="accent-picker">{accents.map((accent) => <button type="button" key={accent} className={form.accent === accent ? 'is-active' : ''} style={{ background: accent }} onClick={() => setForm({ ...form, accent })}>{form.accent === accent && <Check size={15} />}</button>)}<label><input type="color" value={form.accent} onChange={(event) => setForm({ ...form, accent: event.target.value })} /><span>Custom</span></label></div></label>
          </div>

          <label className="field"><span>Owner account</span></label>
          <div className="form-grid">
            <label className="field"><span><User size={14} /> Your name</span><input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} aria-invalid={Boolean(errors.ownerName)} aria-describedby={errors.ownerName ? 'setup-owner-error' : undefined} /><FieldError id="setup-owner-error" message={errors.ownerName} /></label>
            <label className="field"><span><Mail size={14} /> Email</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@studio.com" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'setup-email-error' : undefined} /><FieldError id="setup-email-error" message={errors.email} /></label>
          </div>

          <label className="field"><span><Lock size={14} /> Password</span><div className="password-wrap"><input type={showPassword ? 'text' : 'password'} value={form.ownerPassword} onChange={(event) => setForm({ ...form, ownerPassword: event.target.value })} placeholder="At least 8 characters" aria-invalid={Boolean(errors.ownerPassword)} aria-describedby={errors.ownerPassword ? 'setup-password-error' : undefined} /><button type="button" className="icon-button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><FieldError id="setup-password-error" message={errors.ownerPassword} /></label>

          <label className="toggle-row toggle-row--card"><span><strong>Load the sample data</strong><small>Start from the Northstar demo so you can see how the app feels before adding your own work.</small></span><input type="checkbox" checked={form.loadDemoData} onChange={(event) => setForm({ ...form, loadDemoData: event.target.checked })} /><i /></label>

          {errors.form && <div className="field-error" role="alert">{errors.form}</div>}

          <div className="auth-card__actions">
            <button className="button button--primary" disabled={saving}>{saving ? 'Creating…' : 'Create workspace'} <ArrowRight size={16} /></button>
            <button type="button" className="button button--outline" onClick={() => void enterDemoMode()} disabled={demoBusy}><Sparkles size={16} /> {demoBusy ? 'Opening…' : 'Explore the demo first'}</button>
          </div>
        </form>

        <div className="auth-card__foot"><Palette size={14} /> First run sets up a private workspace. Demo data can be reset or removed from Settings at any time.</div>
      </div>
    </div>
  );
}
