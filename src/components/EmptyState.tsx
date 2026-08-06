import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon"><Icon size={20} /></span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
