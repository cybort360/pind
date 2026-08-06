import { CheckCircle2, Download, FileCheck2 } from 'lucide-react';
import type { Decision, Project, Revision, WorkspaceSettings } from '@shared/types';
import { formatDate } from '../lib';

export function DecisionReceipt({ project, decision, revision, workspace }: { project: Project; decision: Decision; revision?: Revision; workspace: WorkspaceSettings }) {
  function printReceipt() {
    window.print();
  }
  return (
    <div className="receipt-card">
      <div className="receipt-card__head">
        <span className="brand-mark">{workspace.logoText}</span>
        <div><div className="eyebrow">Approval receipt</div><h3>{workspace.name}</h3></div>
        <span className={`receipt-result receipt-result--${decision.type}`}><CheckCircle2 size={16} /> {decision.type === 'approved' ? 'Approved' : 'Changes requested'}</span>
      </div>
      <div className="receipt-card__project"><FileCheck2 size={20} /><div><small>Project</small><strong>{project.name}</strong><span>{project.clientName}</span></div></div>
      <div className="receipt-grid">
        <div><small>Revision</small><strong>{revision ? `V${revision.version} · ${revision.label}` : decision.revisionId}</strong></div>
        <div><small>File</small><strong>{revision?.fileName ?? 'Deliverable'}</strong></div>
        <div><small>Decision by</small><strong>{decision.clientName}</strong><span>{decision.clientEmail}</span></div>
        <div><small>Captured</small><strong>{formatDate(decision.createdAt, 'MMM d, yyyy · h:mm a')}</strong></div>
      </div>
      {decision.note && <div className="receipt-note"><small>Decision note</small><p>{decision.note}</p></div>}
      <div className="receipt-card__foot"><span>Receipt code <strong>{decision.receiptCode}</strong></span><button className="button button--outline button--compact" onClick={printReceipt}><Download size={15} /> Print receipt</button></div>
    </div>
  );
}
