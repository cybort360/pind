import { AlertTriangle, Check, CheckCircle2, Cloud, Database, Mail, Paintbrush, PlugZap, RotateCcw, Save, Slack } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { WorkspaceSettings } from '@shared/types';
import { useApp } from '../state';
import { Modal } from '../components/Modal';

const accents = ['#2f5d50', '#8b4938', '#3e4f7a', '#6a4a73', '#80642f'];

export function SettingsPage() {
  const { state, updateSettings, resetDemo } = useApp();
  const [form, setForm] = useState<WorkspaceSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (state) setForm(state.workspace);
  }, [state?.workspace]);
  if (!state || !form) return null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setSaved(false);
    try {
      await updateSettings(form);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  }

  async function confirmReset() {
    setResetting(true);
    try {
      await resetDemo();
      setResetOpen(false);
    } finally {
      setResetting(false);
    }
  }

  return <div className="page-stack settings-page"><section className="page-intro page-intro--split"><div><div className="eyebrow">White-label controls</div><h2>Workspace settings</h2><p>Change the studio identity once and carry it across the app and client portal.</p></div><button className="button button--outline" onClick={() => setResetOpen(true)}><RotateCcw size={16} /> Reset sample data</button></section><form onSubmit={save} className="settings-layout"><div className="settings-main"><section className="panel settings-section"><header><span><Paintbrush size={18} /></span><div><h3>Brand identity</h3><p>These values appear in the dashboard, review links, and emails.</p></div></header><div className="form-grid"><label className="field"><span>Workspace name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label className="field"><span>Short name</span><input value={form.shortName} onChange={(event) => setForm({ ...form, shortName: event.target.value })} /></label></div><div className="form-grid"><label className="field"><span>Logo letters</span><input maxLength={3} value={form.logoText} onChange={(event) => setForm({ ...form, logoText: event.target.value.toUpperCase() })} /></label><label className="field"><span>Email sender name</span><input value={form.emailFromName} onChange={(event) => setForm({ ...form, emailFromName: event.target.value })} /></label></div><div className="field"><span>Accent colour</span><div className="accent-picker">{accents.map((accent) => <button type="button" key={accent} className={form.accent === accent ? 'is-active' : ''} style={{ background: accent }} onClick={() => setForm({ ...form, accent })}>{form.accent === accent && <Check size={15} />}</button>)}<label><input type="color" value={form.accent} onChange={(event) => setForm({ ...form, accent: event.target.value })} /><span>Custom</span></label></div></div><div className="field"><span>Surface mood</span><div className="surface-options">{(['paper','warm','cool'] as const).map((surface) => <button type="button" className={form.surface === surface ? 'is-active' : ''} onClick={() => setForm({ ...form, surface })} key={surface}><i className={`surface-swatch surface-swatch--${surface}`} /><span><strong>{surface[0].toUpperCase()+surface.slice(1)}</strong><small>{surface === 'paper' ? 'Editorial and neutral' : surface === 'warm' ? 'Soft cream surfaces' : 'Crisp grey surfaces'}</small></span>{form.surface === surface && <Check size={15} />}</button>)}</div></div></section><section className="panel settings-section"><header><span><Mail size={18} /></span><div><h3>Client portal</h3><p>Control the language and safeguards clients see during review.</p></div></header><label className="field"><span>Portal headline</span><textarea rows={3} value={form.portalHeadline} onChange={(event) => setForm({ ...form, portalHeadline: event.target.value })} /></label><label className="field"><span>Approval disclaimer</span><textarea rows={3} value={form.approvalDisclaimer} onChange={(event) => setForm({ ...form, approvalDisclaimer: event.target.value })} /></label><div className="toggle-list"><Toggle label="Require client name" detail="Attach a human name to every comment and decision." checked={form.requireClientName} onChange={(value) => setForm({ ...form, requireClientName: value })} /><Toggle label="Allow file downloads" detail="Show a download action inside client reviews." checked={form.allowDownloads} onChange={(value) => setForm({ ...form, allowDownloads: value })} /><Toggle label="Show revision history" detail="Let clients compare earlier submitted versions." checked={form.showRevisionHistory} onChange={(value) => setForm({ ...form, showRevisionHistory: value })} /></div></section></div><aside className="settings-aside"><section className="panel portal-preview"><div className="eyebrow">Live preview</div><div className="portal-preview__head"><span className="workspace-switcher__logo" style={{ background: form.accent }}>{form.logoText}</span><div><strong>{form.name}</strong><small>Client review portal</small></div></div><div className="portal-preview__body"><span>SUMMER PACKAGING</span><h3>{form.portalHeadline}</h3><p>A secure place for feedback and final approval.</p><span className="portal-preview__approve" style={{ background: form.accent }}>Approve revision</span></div></section><section className="panel settings-section integration-section"><header><span><PlugZap size={18} /></span><div><h3>Integrations</h3><p>Detected from environment variables.</p></div></header><IntegrationRow icon={Database} name="Replit Database" description="Persistent PostgreSQL state" connected={state.integrations.database} env="DATABASE_URL" /><IntegrationRow icon={Mail} name="Resend" description="Review invitations and receipts" connected={state.integrations.email} env="RESEND_API_KEY" /><IntegrationRow icon={Cloud} name="Cloudinary" description="Deliverable file storage" connected={state.integrations.cloudinary} env="CLOUDINARY_*" /><IntegrationRow icon={Slack} name="Slack" description="Approval notifications" connected={state.integrations.slack} env="SLACK_WEBHOOK_URL" /></section><button className="button button--primary settings-save" disabled={saving}><Save size={16} /> {saving ? 'Saving…' : saved ? <><CheckCircle2 size={16} /> Saved</> : 'Save workspace'}</button></aside></form>
    <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="Reset sample data?" eyebrow="Destructive action" size="sm">
      <div className="confirm-dialog">
        <span className="confirm-dialog__icon"><AlertTriangle size={22} /></span>
        <p>This replaces the current workspace with the original Northstar demo. Any clients, projects, comments, and decisions you added will be permanently deleted.</p>
        <div className="modal__footer">
          <button type="button" className="button button--ghost" onClick={() => setResetOpen(false)}>Cancel</button>
          <button type="button" className="button button--danger" onClick={() => void confirmReset()} disabled={resetting}>{resetting ? 'Resetting…' : 'Reset sample data'}</button>
        </div>
      </div>
    </Modal>
  </div>;
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-row"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label>; }
function IntegrationRow({ icon: Icon, name, description, connected, env }: { icon: typeof Database; name: string; description: string; connected: boolean; env: string }) { return <div className="integration-row"><span><Icon size={17} /></span><div><strong>{name}</strong><small>{description}</small><code>{env}</code></div><em className={connected ? 'is-connected' : ''}>{connected ? 'Connected' : 'Optional'}</em></div>; }