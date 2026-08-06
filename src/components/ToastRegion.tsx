import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useApp } from '../state';

export function ToastRegion() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.tone === 'error' ? AlertCircle : toast.tone === 'info' ? Info : CheckCircle2;
        return (
          <div className={`toast toast--${toast.tone ?? 'success'}`} key={toast.id}>
            <Icon size={18} />
            <div>
              <strong>{toast.title}</strong>
              {toast.detail && <span>{toast.detail}</span>}
            </div>
            <button onClick={() => dismissToast(toast.id)} aria-label="Dismiss"><X size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}
