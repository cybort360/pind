import { CheckCircle2, FileUp, Link2, MessageSquare, Plus, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Activity } from '@shared/types';
import { relativeDate } from '../lib';

const icons = {
  comment: MessageSquare,
  upload: FileUp,
  approval: CheckCircle2,
  invite: Link2,
  resolve: RotateCcw,
  project: Plus,
};

export function ActivityFeed({ items, limit }: { items: Activity[]; limit?: number }) {
  return (
    <div className="activity-feed">
      {items.slice(0, limit ?? items.length).map((item) => {
        const Icon = icons[item.type];
        const content = (
          <>
            <span className={`activity-feed__icon activity-feed__icon--${item.type}`}><Icon size={16} /></span>
            <span className="activity-feed__content">
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
              <small>{item.actor} · {relativeDate(item.createdAt)}</small>
            </span>
          </>
        );
        return item.projectId ? (
          <Link to={`/app/projects/${item.projectId}`} className="activity-feed__item" key={item.id}>{content}</Link>
        ) : (
          <div className="activity-feed__item" key={item.id}>{content}</div>
        );
      })}
    </div>
  );
}
