import { Filter, Grid2X2, List, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../state';
import { ProjectCard } from '../components/ProjectCard';
import { NewProjectModal } from '../components/NewProjectModal';
import { StatusBadge } from '../components/StatusBadge';
import { Link } from 'react-router-dom';
import { dueLabel, relativeDate } from '../lib';

export function ProjectsPage() {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<'recent' | 'due' | 'name'>('recent');
  if (!state) return null;

  const categories = Array.from(new Set(state.projects.map((project) => project.category))).sort();
  const filtered = state.projects
    .filter((project) => {
      const matchesQuery = `${project.name} ${project.clientName} ${project.category}`.toLowerCase().includes(query.toLowerCase());
      const matchesStatus = status === 'all' || project.status === status;
      const matchesCategory = category === 'all' || project.category === category;
      return matchesQuery && matchesStatus && matchesCategory;
    })
    .sort((a, b) => {
      if (sort === 'due') return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (sort === 'name') return a.name.localeCompare(b.name);
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  return (
    <div className="page-stack">
      <section className="page-intro page-intro--split">
        <div><div className="eyebrow">Client work</div><h2>Projects</h2><p>Every deliverable, decision, and revision in one place.</p></div>
        <button className="button button--primary" onClick={() => setNewProjectOpen(true)}><Plus size={17} /> New project</button>
      </section>

      <section className="toolbar">
        <label className="toolbar__search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project, client, or category" /></label>
        <div className="toolbar__filters">
          <label className="select-control"><Filter size={16} /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="in-review">In review</option><option value="changes-requested">Changes requested</option><option value="draft">Draft</option><option value="approved">Approved</option></select></label>
          <button className="button button--outline button--compact" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}><SlidersHorizontal size={16} /> {filtersOpen ? 'Hide filters' : 'More filters'}</button>
          <div className="view-toggle"><button className={view === 'grid' ? 'is-active' : ''} onClick={() => setView('grid')} aria-label="Grid view"><Grid2X2 size={16} /></button><button className={view === 'list' ? 'is-active' : ''} onClick={() => setView('list')} aria-label="List view"><List size={16} /></button></div>
        </div>
      </section>

      {filtersOpen && <section className="advanced-filters panel"><label className="field field--compact"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select></label><label className="field field--compact"><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value as 'recent' | 'due' | 'name')}><option value="recent">Recent activity</option><option value="due">Due date</option><option value="name">Project name</option></select></label><button className="button button--ghost button--compact" onClick={() => { setQuery(''); setStatus('all'); setCategory('all'); setSort('recent'); }}>Reset filters</button></section>}

      <div className="results-meta"><span>{filtered.length} {filtered.length === 1 ? 'project' : 'projects'}</span><span>{sort === 'recent' ? 'Sorted by recent activity' : sort === 'due' ? 'Sorted by due date' : 'Sorted by project name'}</span></div>

      {view === 'grid' ? (
        <section className="projects-grid">{filtered.map((project) => <ProjectCard project={project} key={project.id} />)}</section>
      ) : (
        <section className="projects-table panel">
          <div className="projects-table__head"><span>Project</span><span>Status</span><span>Progress</span><span>Due</span><span>Updated</span></div>
          {filtered.map((project) => (
            <Link className="projects-table__row" to={`/app/projects/${project.id}`} key={project.id}>
              <span className="project-cell"><img src={project.cover} alt="" /><span><strong>{project.name}</strong><small>{project.clientName} · {project.category}</small></span></span>
              <StatusBadge status={project.status} />
              <span className="table-progress"><i><b style={{ width: `${project.progress}%` }} /></i><em>{project.progress}%</em></span>
              <span>{dueLabel(project.dueAt)}</span>
              <span>{relativeDate(project.updatedAt)}</span>
            </Link>
          ))}
        </section>
      )}

      {filtered.length === 0 && <div className="no-results"><Search size={20} /><h3>No projects match that filter.</h3><p>Try a broader search or reset the status filter.</p><button className="button button--outline" onClick={() => { setQuery(''); setStatus('all'); setCategory('all'); setSort('recent'); }}>Clear filters</button></div>}
      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  );
}
