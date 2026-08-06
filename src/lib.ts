import { format, formatDistanceToNowStrict, isPast } from 'date-fns';
import type { ProjectStatus } from '@shared/types';

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(value: string, pattern = 'MMM d, yyyy') {
  return format(new Date(value), pattern);
}

export function relativeDate(value: string) {
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export function dueLabel(value: string) {
  const date = new Date(value);
  if (isPast(date)) return `Overdue ${formatDate(value, 'MMM d')}`;
  return `Due ${formatDate(value, 'MMM d')}`;
}

export function statusLabel(status: ProjectStatus) {
  return {
    'in-review': 'In review',
    'changes-requested': 'Changes requested',
    approved: 'Approved',
    draft: 'Draft',
  }[status];
}

export function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error ?? 'Request failed');
  }
  return data as T;
}
