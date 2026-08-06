import { ArrowRight, CheckCircle2, Clock3, FolderKanban, MessageSquare, Plus, TrendingUp, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useApp } from '../state';
import { ProjectCard } from '../components/ProjectCard';
import { ActivityFeed } from '../components/ActivityFeed';
import { NewProjectModal } from '../components/NewProjectModal';
import { formatDate } from '../lib';

export function DashboardPage() {
  const { state } = useApp();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  if (!state) return null;

  const active = state.projects.filter((project) => project.status !== 'approved').length;
  const awaiting = state.projects.filter((project) => project.status === 'in-review').length;
  const approved = state.projects.filter((project) => project.status === 'approved').length;
  const comments = state.projects.flatMap((project) => project.comments).filter((comment) => comment.status === 'open').length;
  const decisions = state.projects.flatMap((project) => project.decisions);
  const approvalRate = decisions.length ? Math.round((decisions.filter((decision) => decision.type === 'approved').length / decisions.length) * 100) : 0;
  const metrics = { active, awaiting, approved, comments, approvalRate };
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const decisionsNeeded = state.projects.filter((project) => project.status === 'in-review' || project.status === 'changes-requested').length;

  const nextProject = [...state.projects]
    .filter((project) => project.status !== 'approved')
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];

  return (
    <div className="page-stack">
      <section className="page-intro page-intro--split">
        <div>
          <div className="eyebrow">{formatDate(now.toISOString(), 'EEEE, MMMM d')}</div>
          <h2>{greeting}, Maya.</h2>
          <p>{decisionsNeeded ? `${decisionsNeeded} client ${decisionsNeeded === 1 ? 'decision needs' : 'decisions need'} attention.` : 'No client decisions are waiting. Everything is moving.'}</p>
        </div>
        <button className="button button--primary" onClick={() => setNewProjectOpen(true)}><Plus size={17} /> New project</button>
      </section>

      <section className="metric-grid">
        <article className="metric-card"><span className="metric-card__icon"><FolderKanban size={18} /></span><div><small>Active projects</small><strong>{metrics.active}</strong><em><TrendingUp size={13} /> 2 due this week</em></div></article>
        <article className="metric-card"><span className="metric-card__icon"><Clock3 size={18} /></span><div><small>Awaiting review</small><strong>{metrics.awaiting}</strong><em>Client links are live</em></div></article>
        <article className="metric-card"><span className="metric-card__icon"><MessageSquare size={18} /></span><div><small>Open comments</small><strong>{metrics.comments}</strong><em>Across {state.projects.filter((project) => project.comments.some((comment) => comment.status === 'open')).length} projects</em></div></article>
        <article className="metric-card"><span className="metric-card__icon"><CheckCircle2 size={18} /></span><div><small>Approval rate</small><strong>{metrics.approvalRate}%</strong><em>{metrics.approved} approved project</em></div></article>
      </section>

      {nextProject && (
        <section className="attention-card">
          <div className="attention-card__visual"><img src={nextProject.cover} alt="" /></div>
          <div className="attention-card__copy">
            <div className="eyebrow">Needs attention</div>
            <h3>{nextProject.name}</h3>
            <p>{nextProject.comments.filter((comment) => comment.status === 'open').length} open feedback points · {nextProject.clientName} · Due {formatDate(nextProject.dueAt, 'EEEE')}</p>
          </div>
          <Link className="button button--light" to={`/app/projects/${nextProject.id}`}>Open project <ArrowRight size={16} /></Link>
        </section>
      )}

      <div className="dashboard-grid">
        <section className="panel panel--projects">
          <header className="panel__header"><div><h3>Recent projects</h3><p>The work closest to a client decision.</p></div><Link to="/app/projects" className="text-link">View all <ArrowRight size={14} /></Link></header>
          <div className="project-list-grid">{state.projects.slice(0, 3).map((project) => <ProjectCard project={project} compact key={project.id} />)}</div>
        </section>

        <aside className="panel">
          <header className="panel__header"><div><h3>Latest activity</h3><p>What changed across the workspace.</p></div></header>
          <ActivityFeed items={state.activities} limit={5} />
          <Link className="panel__footer-link" to="/app/activity">See full activity <ArrowRight size={14} /></Link>
        </aside>
      </div>

      <section className="panel client-overview">
        <header className="panel__header"><div><h3>Client pulse</h3><p>Who is active and where work is waiting.</p></div><Link to="/app/clients" className="text-link">Manage clients <ArrowRight size={14} /></Link></header>
        <div className="client-pulse-grid">
          {state.clients.slice(0, 4).map((client) => (
            <article className="client-pulse" key={client.id}>
              <span className="avatar">{client.avatar}</span>
              <div><strong>{client.company}</strong><span>{client.name}</span><small>{client.activeProjects} active {client.activeProjects === 1 ? 'project' : 'projects'}</small></div>
              <span className={`client-state client-state--${client.status}`}>{client.status}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="integration-strip">
        <div><span className="integration-strip__icon"><Users size={18} /></span><div><strong>Template health</strong><small>{Object.values(state.integrations).filter(Boolean).length} of 4 optional integrations connected</small></div></div>
        <div className="integration-pills">
          {Object.entries(state.integrations).map(([name, connected]) => <span className={connected ? 'is-connected' : ''} key={name}><i />{name}</span>)}
        </div>
        <Link to="/app/settings" className="text-link">Configure <ArrowRight size={14} /></Link>
      </section>

      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  );
}
