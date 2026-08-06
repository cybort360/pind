import { X } from 'lucide-react';
import { useEffect } from 'react';

export function Modal({
  open,
  title,
  eyebrow,
  children,
  onClose,
  size = 'md',
}: {
  open: boolean;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal__header">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2>{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button>
        </header>
        <div className="modal__body">{children}</div>
      </section>
    </div>
  );
}
