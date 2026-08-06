import { Activity, CalendarDays, Filter, Search } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../state';
import { ActivityFeed } from '../components/ActivityFeed';

export function ActivityPage() {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  if (!state) return null;
  const items = state.activities.filter((item) => {
    const text = `${item.title} ${item.detail} ${item.actor}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (type === 'all' || item.type === type);
  });

  return <div className="page-stack"><section className="page-intro"><div className="eyebrow">Audit trail</div><h2>Workspace activity</h2><p>Uploads, invitations, comments, resolutions, and decisions in chronological order.</p></section><section className="toolbar"><label className="toolbar__search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity" /></label><div className="toolbar__filters"><label className="select-control"><Filter size={16} /><select value={type} onChange={(event) => setType(event.target.value)}><option value="all">All activity</option><option value="comment">Comments</option><option value="upload">Uploads</option><option value="approval">Decisions</option><option value="invite">Invitations</option><option value="resolve">Resolved feedback</option></select></label><span className="date-chip"><CalendarDays size={15} /> Last 30 days</span></div></section><section className="panel activity-page-panel"><div className="activity-page-panel__head"><span><Activity size={18} /></span><div><strong>{items.length} events</strong><small>All times shown in your browser timezone.</small></div></div><ActivityFeed items={items} /></section></div>;
}
