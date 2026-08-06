import { ArrowUpRight, Building2, Mail, Plus, Search, UserRoundCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import type { AppState } from '@shared/types';
import { useApp } from '../state';
import { api, relativeDate } from '../lib';
import { Modal } from '../components/Modal';

export function ClientsPage() {
  const { state, setState, notify } = useApp();
  const [query, setQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  if (!state) return null;
  const clients = state.clients.filter((client) => `${client.name} ${client.company} ${client.email}`.toLowerCase().includes(query.toLowerCase()));

  return <div className="page-stack">
    <section className="page-intro page-intro--split"><div><div className="eyebrow">Relationships</div><h2>Clients</h2><p>Contacts, active work, and review status without a separate CRM.</p></div><button className="button button--primary" onClick={() => setAddOpen(true)}><Plus size={17} /> Add client</button></section>
    <section className="client-stats"><article><span><Users size={18} /></span><div><strong>{state.clients.length}</strong><small>Total clients</small></div></article><article><span><UserRoundCheck size={18} /></span><div><strong>{state.clients.filter((client) => client.status === 'active').length}</strong><small>Active now</small></div></article><article><span><Building2 size={18} /></span><div><strong>{state.clients.reduce((sum, client) => sum + client.activeProjects, 0)}</strong><small>Open projects</small></div></article></section>
    <section className="toolbar"><label className="toolbar__search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients" /></label><span className="toolbar-note">Client activity updates when a review link is used.</span></section>
    <section className="clients-grid">{clients.map((client) => {
      const projects = state.projects.filter((project) => project.clientId === client.id);
      return <article className="client-card" key={client.id}><div className="client-card__top"><span className="avatar avatar--lg">{client.avatar}</span><span className={`client-state client-state--${client.status}`}>{client.status}</span></div><h3>{client.company}</h3><p>{client.name}</p><a href={`mailto:${client.email}`}><Mail size={14} /> {client.email}</a><div className="client-card__facts"><span><strong>{projects.length}</strong> projects</span><span>Active {relativeDate(client.lastActiveAt)}</span></div><div className="client-card__projects">{projects.slice(0, 2).map((project) => <Link to={`/app/projects/${project.id}`} key={project.id}><span><strong>{project.name}</strong><small>{project.category}</small></span><ArrowUpRight size={15} /></Link>)}{!projects.length && <span className="client-card__empty">No current projects</span>}</div></article>;
    })}</section>
    {!clients.length && <div className="no-results"><Search size={20} /><h3>No clients match that search.</h3><p>Try a company name, contact, or email address.</p><button className="button button--outline" onClick={() => setQuery('')}>Clear search</button></div>}
    <AddClientModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={(next) => { setState(next); notify('Client added', 'You can now create a project and share a review link.'); }} />
  </div>;
}

function AddClientModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (state: AppState) => void }) {
  const { notify } = useApp();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', company: '', email: '' });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await api<AppState>('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      onCreated(next);
      setForm({ name: '', company: '', email: '' });
      onClose();
    } catch (error) {
      notify('Could not add client', error instanceof Error ? error.message : 'Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return <Modal open={open} onClose={onClose} title="Add a client" eyebrow="New relationship"><form className="form-stack" onSubmit={submit}><div className="form-grid"><label className="field"><span>Contact name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Amina Bello" required /></label><label className="field"><span>Company</span><input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Common Ground" required /></label></div><label className="field"><span>Email address</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="amina@commonground.example" required /></label><div className="modal__footer"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={saving}>{saving ? 'Adding…' : 'Add client'}</button></div></form></Modal>;
}
