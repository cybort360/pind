import { useState } from 'react';
import type { AppState } from '@shared/types';
import { api } from '../lib';
import { useApp } from '../state';
import { Modal } from './Modal';

export function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, setState, notify } = useApp();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    clientId: state?.clients.find((client) => client.status === 'active')?.id ?? '',
    category: 'Brand & Packaging',
    description: '',
    dueAt: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    budgetLabel: '$3,500',
  });

  if (!state) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api<AppState>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, dueAt: new Date(`${form.dueAt}T17:00:00`).toISOString() }),
      });
      setState(next);
      notify('Project created', `${form.name} is ready for its first revision.`);
      onClose();
      setForm((current) => ({ ...current, name: '', description: '' }));
    } catch (error) {
      notify('Could not create project', error instanceof Error ? error.message : 'Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a client project" eyebrow="New project" size="md">
      <form className="form-stack" onSubmit={submit}>
        <label className="field"><span>Project name</span><input required minLength={3} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Winter campaign system" /></label>
        <div className="form-grid">
          <label className="field"><span>Client</span><select value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}>{state.clients.filter((client) => client.status !== 'archived').map((client) => <option value={client.id} key={client.id}>{client.company}</option>)}</select></label>
          <label className="field"><span>Category</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Brand & Packaging</option><option>Campaign</option><option>Web Design</option><option>Video</option><option>Print</option><option>Product Design</option></select></label>
        </div>
        <label className="field"><span>Brief</span><textarea required minLength={8} rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the work the client will review." /></label>
        <div className="form-grid">
          <label className="field"><span>Review due</span><input type="date" required value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} /></label>
          <label className="field"><span>Budget label</span><input value={form.budgetLabel} onChange={(event) => setForm({ ...form, budgetLabel: event.target.value })} /></label>
        </div>
        <div className="modal__footer"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={saving}>{saving ? 'Creating…' : 'Create project'}</button></div>
      </form>
    </Modal>
  );
}
