import { ArrowUpRight, MessageSquare, Paperclip } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Project } from '@shared/types';
import { dueLabel, relativeDate } from '../lib';
import { StatusBadge } from './StatusBadge';

export function ProjectCard({ project, compact = false }: { project: Project; compact?: boolean }) {
  const openComments = project.comments.filter((comment) => comment.status === 'open').length;
  const latest = project.revisions.at(-1);

  return (
    <Link to={`/app/projects/${project.id}`} className={`project-card ${compact ? 'project-card--compact' : ''}`}>
      <div className="project-card__cover">
        <img src={project.cover} alt="" />
        <span className="project-card__category">{project.category}</span>
        <span className="project-card__arrow"><ArrowUpRight size={16} /></span>
      </div>
      <div className="project-card__body">
        <div className="project-card__header">
          <div>
            <small>{project.clientName}</small>
            <h3>{project.name}</h3>
          </div>
          <StatusBadge status={project.status} />
        </div>
        {!compact && <p>{project.description}</p>}
        <div className="project-progress"><span style={{ width: `${project.progress}%` }} /></div>
        <div className="project-card__meta">
          <span>{dueLabel(project.dueAt)}</span>
          <span><Paperclip size={14} /> {project.revisions.length}</span>
          <span><MessageSquare size={14} /> {openComments}</span>
          <span>{latest ? `Updated ${relativeDate(project.updatedAt)}` : 'No revision yet'}</span>
        </div>
      </div>
    </Link>
  );
}
