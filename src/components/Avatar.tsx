import { initials } from '../lib';

export function Avatar({ name, size = 'md', label }: { name: string; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  return (
    <span className={`avatar avatar--${size}`} role="img" aria-label={label ?? name} title={label ?? name}>
      {initials(name)}
    </span>
  );
}
