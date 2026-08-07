import { useState } from 'react';
import type { AppState } from '@shared/types';
import { api } from '../lib';
import { useApp } from '../state';
import { Modal } from './Modal';
import { FieldError } from './FieldError';

interface FormState {
  name: string;
  clientId: string;
  category: string;
  description: string;
  dueAt: string;
  budgetLabel: string;
}

const initialClientId = (state: AppState | null) =>
  state?.clients.find((client) => client.status === 'active')?.id ?? '';

const defaultDue = () => new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);

function freshForm(state: AppState | null): FormState {
  return {
    name: '',
    clientId: initialClientId(state),
    category: 'Brand & Packaging',
    description: '',
    dueAt: defaultDue(),
    budgetLabel: '$3,000',
  };
}

export function NewProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, setState, notify, config } = useApp();
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [form, setForm] = useState<FormState>(() => {
    const initial = freshForm(state);
    if (config?.projectCategories[0]) initial.category = config.projectCategories[0].label;
    return initial;
  });

  function update<Field extends keyof FormState>(field: Field, value: FormState[Field]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (form.name.trim().length < 3) next.name = 'Enter a project name of at least 3 characters.';
    if (!form.clientId) next.clientId = 'Choose a client for this project.';
    if (form.description.trim().length < 8) next.description = 'Describe the work in at least a sentence.';
    if (!form.dueAt) next.dueAt = 'Choose a review due date.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;
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
      setForm(freshForm(next));
      setErrors({});
    } catch (error) {
      notify('Could not create project', error instanceof Error ? error.message : 'Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a client project" eyebrow="New project" size="md">
      {state && (
      <form className="form-stack" onSubmit={submit} noValidate>
        <label className="field">
          <span>Project name</span>
          <input required value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Winter campaign system" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'new-project-name-error' : undefined} />
          <FieldError id="new-project-name-error" message={errors.name} />
        </label>
        <div className="form-grid">
          <label className="field"><span>Client</span><select value={form.clientId} onChange={(event) => update('clientId', event.target.value)} aria-invalid={!!errors.clientId}>{state.clients.filter((client) => client.status !== 'archived').map((client) => <option value={client.id} key={client.id}>{client.company}</option>)}</select><FieldError message={errors.clientId} /></label>
          <label className="field"><span>Category</span><select value={form.category} onChange={(event) => update('category', event.target.value)}>{(config?.projectCategories ?? []).map((category) => <option value={category.label} key={category.id}>{category.label}</option>)}</select></label>
        </div>
        <label className="field"><span>Brief</span><textarea rows={4} value={form.description} onChange={(event) => update('description', event.target.value)} placeholder="Describe the work the client will review." aria-invalid={!!errors.description} aria-describedby={errors.description ? 'new-project-brief-error' : undefined} /><FieldError id="new-project-brief-error" message={errors.description} /></label>
        <div className="form-grid">
          <label className="field"><span>Review due</span><input type="date" required value={form.dueAt} onChange={(event) => update('dueAt', event.target.value)} /><FieldError message={errors.dueAt} /></label>
          <label className="field"><span>Budget label</span><input value={form.budgetLabel} onChange={(event) => update('budgetLabel', event.target.value)} /></label>
        </div>
        <div className="modal__footer"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={saving}>{saving ? 'Creating…' : 'Create project'}</button></div>
      </form>
      )}
    </Modal>
  );
}

function initialProjectForm(state: AppState): FormState {
  return {
    name: '',
    clientId: initialClientId(state),
    category: 'Brand & Packaging',
    description: '',
    dueAt: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    budgetLabel: '$3,000',
  };
}