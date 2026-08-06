import type { ProjectStatus } from '@shared/types';
import { statusLabel } from '../lib';

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`status status--${status}`}>{statusLabel(status)}</span>;
}
