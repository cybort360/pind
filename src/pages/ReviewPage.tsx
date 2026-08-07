import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  File,
  FileCheck2,
  LockKeyhole,
  MessageSquare,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { Comment, DecisionType, ReviewPayload } from '@shared/types';
import { useApp } from '../state';
import { api, cn, formatDate, relativeDate } from '../lib';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { DecisionReceipt } from '../components/DecisionReceipt';
import { FieldError } from '../components/FieldError';

export function ReviewPage() {
  const { token = '' } = useParams();
  const { notify } = useApp();
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedRevisionId, setSelectedRevisionId] = useState('');
  const [pinDraft, setPinDraft] = useState<{ x: number; y: number } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [clientName, setClientName] = useState('Client reviewer');
  const [decisionOpen, setDecisionOpen] = useState<DecisionType | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mobileComments, setMobileComments] = useState(false);
  const [composerError, setComposerError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<ReviewPayload>(`/api/review/${token}`)
      .then((result) => {
        if (!active) return;
        setPayload(result);
        setClientName(result.client?.name ?? 'Client reviewer');
        setLoadError('');
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'Review link not found');
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token]);

  if (loading) {
    return <div className="boot-screen"><span className="brand-mark brand-mark--large">P</span><div className="boot-line"><span /></div><p>Opening the project review</p></div>;
  }

  if (!payload || loadError) {
    return <div className="review-not-found"><span className="brand-mark">P</span><h1>This review link is no longer available.</h1><p>{loadError || 'Ask the project owner for a fresh Pind link.'}</p><Link to="/" className="button button--outline"><ArrowLeft size={16} /> Back to Pind</Link></div>;
  }

  const { project, workspace, client } = payload;
  const selectedRevision = project.revisions.find((item) => item.id === selectedRevisionId) ?? project.revisions.at(-1);
  const comments = project.comments.filter((comment) => comment.revisionId === selectedRevision?.id);
  const pinnedCommentNumbers = new Map(
    comments
      .filter((comment) => comment.x !== undefined && comment.y !== undefined)
      .map((comment, index) => [comment.id, index + 1]),
  );
  const latestDecision = project.decisions[0];
  const latestDecisionRevision = project.revisions.find((item) => item.id === latestDecision?.revisionId);

  const openFeedbackCount = comments.filter((comment) => comment.status === 'open').length;
  const progressLabel = project.status === 'approved'
    ? 'Approved and ready for handoff'
    : project.status === 'changes-requested'
      ? 'Changes requested'
      : `${openFeedbackCount} open feedback ${openFeedbackCount === 1 ? 'point' : 'points'}`;

  async function addComment() {
    if (!selectedRevision || !commentBody.trim()) return;
    if (workspace.requireClientName && clientName.trim().length < 2) {
      setComposerError('Add your name so the studio can credit this feedback.');
      return;
    }
    setComposerError('');
    setSaving(true);
    try {
      const next = await api<ReviewPayload>(`/api/review/${token}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revisionId: selectedRevision.id,
          author: clientName,
          authorRole: 'client',
          body: commentBody,
          x: pinDraft?.x,
          y: pinDraft?.y,
        }),
      });
      setPayload(next);
      setCommentBody('');
      setPinDraft(null);
      notify('Feedback added', 'The studio can now resolve this point against the revision.');
    } catch (error) {
      notify('Could not add feedback', error instanceof Error ? error.message : 'Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function onCanvasClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setPinDraft({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
    setComposerError('');
    setMobileComments(true);
  }

  function onCanvasKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setPinDraft({ x: 50, y: 50 });
    setComposerError('');
    setMobileComments(true);
  }

  return (
    <div className="client-review" style={{ '--client-accent': workspace.accent, '--accent': workspace.accent } as React.CSSProperties}>
      <header className="client-review__header">
        <div className="client-brand"><span className="workspace-switcher__logo">{workspace.logoText}</span><span><strong>{workspace.name}</strong><small>Client review portal</small></span></div>
        <div className="review-security"><LockKeyhole size={14} /> Project-scoped review link</div>
        <div className="client-identity"><span>Reviewing as</span><Avatar name={clientName} size="sm" /><strong>{clientName}</strong></div>
      </header>

      <section className="client-project-head">
        <div><div className="eyebrow">{project.category} · {project.clientName}</div><h1>{project.name}</h1><p>{project.description}</p></div>
        <div className="client-project-head__meta"><span><small>Due date</small><strong>{formatDate(project.dueAt, 'MMM d, yyyy')}</strong></span><span><small>Project status</small><strong>{progressLabel}</strong></span></div>
      </section>

      <main className="client-review__workspace">
        <section className="client-stage">
          <div className="client-artboard-shell">
            <header className="client-stage__toolbar">
              <div className="revision-select-wrap"><small>Revision</small><select value={selectedRevision?.id ?? ''} onChange={(event) => setSelectedRevisionId(event.target.value)}>{project.revisions.slice().reverse().map((revision) => <option value={revision.id} key={revision.id}>V{revision.version} · {revision.label}</option>)}</select><ChevronDown size={15} /></div>
              {selectedRevision && <div className="client-stage__file"><strong>{selectedRevision.fileName}</strong><span>{selectedRevision.sizeLabel} · Uploaded {relativeDate(selectedRevision.uploadedAt)}</span></div>}
              {selectedRevision && workspace.allowDownloads && <a href={selectedRevision.fileUrl} download className="button button--outline button--compact"><Download size={15} /> Download</a>}
            </header>

            {selectedRevision ? (
              <div className="client-stage__file-area">
                <div className="artboard-instruction"><MessageSquare size={14} /> Click the work to leave precise feedback</div>
                <div className="artboard client-artboard" onClick={onCanvasClick} onKeyDown={onCanvasKeyDown} role="button" tabIndex={0} aria-label="Artwork. Press Enter or Space to place a feedback pin here.">
                  {selectedRevision.kind === 'image' || selectedRevision.thumbnail
                    ? <img src={selectedRevision.thumbnail ?? selectedRevision.fileUrl} alt={selectedRevision.label} />
                    : <div className="file-preview"><File size={42} /><strong>{selectedRevision.fileName}</strong><a href={selectedRevision.fileUrl}>Open deliverable</a></div>}
                  {comments.filter((comment) => comment.x !== undefined && comment.y !== undefined).map((comment) => (
                    <button
                      key={comment.id}
                      className={cn('pin', comment.status === 'resolved' && 'pin--resolved')}
                      aria-label={`Comment ${pinnedCommentNumbers.get(comment.id)}: ${comment.body}`}
                      title={comment.body}
                      style={{ left: `${comment.x}%`, top: `${comment.y}%` }}
                      onClick={(event) => {
                        event.stopPropagation();
                        document.getElementById(`review-comment-${comment.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                    >{pinnedCommentNumbers.get(comment.id)}</button>
                  ))}
                  {pinDraft && <span className="pin pin--draft" style={{ left: `${pinDraft.x}%`, top: `${pinDraft.y}%` }}>+</span>}
                </div>
                <div className="client-revision-note"><div><strong>What changed in this version</strong><p>{selectedRevision.note}</p></div><span>V{selectedRevision.version}</span></div>
              </div>
            ) : <div className="first-upload"><File size={28} /><h3>No deliverable is ready yet.</h3><p>The studio will notify you when the first revision is uploaded.</p></div>}
          </div>

          <aside className={cn('client-comments', mobileComments && 'client-comments--open')}>
            <header><div><h2>Feedback</h2><p>{comments.filter((comment) => comment.status === 'open').length} open on this revision</p></div><button className="icon-button client-comments__close" onClick={() => setMobileComments(false)}><X size={18} /></button></header>
            <div className="client-comments__list">
              {comments.map((comment) => <ClientComment key={comment.id} comment={comment} pinNumber={pinnedCommentNumbers.get(comment.id)} />)}
              {!comments.length && <div className="comments-empty"><MessageSquare size={20} /><strong>Nothing pinned yet.</strong><span>Click the work to add the first feedback point.</span></div>}
            </div>
            {selectedRevision && <div className="client-composer">{pinDraft && <div className="pin-context"><span>+</span> Pin at {Math.round(pinDraft.x)}%, {Math.round(pinDraft.y)}%<button onClick={() => setPinDraft(null)}><X size={13} /></button></div>}<label className="field field--compact"><span>Your name</span><input value={clientName} onChange={(event) => setClientName(event.target.value)} required={workspace.requireClientName} /></label><textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} rows={4} placeholder={pinDraft ? 'What should change here?' : 'Leave a general note on this revision…'} /><FieldError message={composerError} /><button className="button button--primary" onClick={() => void addComment()} disabled={!commentBody.trim() || saving}>{saving ? 'Adding…' : <><Send size={15} /> Add feedback</>}</button></div>}
          </aside>
        </section>
      </main>

      <button className="mobile-feedback-button" onClick={() => setMobileComments(true)}><MessageSquare size={16} /> Feedback <span>{comments.filter((comment) => comment.status === 'open').length}</span></button>

      {workspace.showRevisionHistory && <section className="revision-history"><header><div><div className="eyebrow">Revision history</div><h2>See how the work changed.</h2></div><span>{project.revisions.length} versions</span></header><div className="revision-history__grid">{project.revisions.slice().reverse().map((revision) => <button key={revision.id} className={selectedRevision?.id === revision.id ? 'is-active' : ''} onClick={() => setSelectedRevisionId(revision.id)}><div><img src={revision.thumbnail ?? project.cover} alt="" /><span>V{revision.version}</span></div><strong>{revision.label}</strong><small>{formatDate(revision.uploadedAt)}</small></button>)}</div></section>}

      <section className={cn('decision-bar', project.status === 'approved' && 'decision-bar--approved')}>
        <div>{project.status === 'approved' ? <span className="decision-bar__icon"><CheckCircle2 size={20} /></span> : <span className="decision-bar__icon"><ShieldCheck size={20} /></span>}<div><strong>{project.status === 'approved' ? 'This revision is approved.' : 'Ready to make a decision?'}</strong><span>{project.status === 'approved' ? `Captured from ${latestDecision?.clientName ?? 'the client'}.` : workspace.approvalDisclaimer}</span></div></div>
        <div>{project.status === 'approved' && latestDecision ? <button className="button button--light" onClick={() => setReceiptOpen(true)}><FileCheck2 size={16} /> View approval receipt</button> : <><button className="button button--ghost-light" onClick={() => setDecisionOpen('changes-requested')} disabled={!selectedRevision}><X size={16} /> Request changes</button><button className="button button--light" onClick={() => setDecisionOpen('approved')} disabled={!selectedRevision}><Check size={16} /> Approve revision</button></>}</div>
      </section>

      <DecisionModal type={decisionOpen} onClose={() => setDecisionOpen(null)} token={token} project={project} revisionId={selectedRevision?.id ?? ''} clientName={clientName} clientEmail={client?.email ?? 'client@example.com'} onPayload={setPayload} onComplete={() => setReceiptOpen(true)} />
      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} title="Approval confirmed" eyebrow="Decision receipt" size="lg">{latestDecision ? <DecisionReceipt project={project} decision={latestDecision} revision={latestDecisionRevision} workspace={workspace} /> : <div className="mini-empty"><FileCheck2 size={20} /><span>The receipt will appear after a decision.</span></div>}</Modal>
    </div>
  );
}

function ClientComment({ comment, pinNumber }: { comment: Comment; pinNumber?: number }) {
  return <article id={`review-comment-${comment.id}`} className={cn('comment-card', comment.status === 'resolved' && 'comment-card--resolved')}><div className="comment-card__top"><Avatar name={comment.author} size="sm" /><div><strong>{comment.author}</strong><span>{comment.authorRole === 'client' ? 'Client' : 'Studio'} · {relativeDate(comment.createdAt)}</span></div>{pinNumber !== undefined && <em>{pinNumber}</em>}</div><p>{comment.body}</p>{comment.reply && <div className="comment-reply"><span className="avatar avatar--sm">MO</span><p><strong>Studio response</strong>{comment.reply}</p></div>}<div className="comment-card__foot">{comment.status === 'resolved' ? <span><CheckCircle2 size={14} /> Resolved</span> : <span className="open-label">Open</span>}</div></article>;
}

function DecisionModal({ type, onClose, token, project, revisionId, clientName, clientEmail, onPayload, onComplete }: { type: DecisionType | null; onClose: () => void; token: string; project: { id: string; name: string }; revisionId: string; clientName: string; clientEmail: string; onPayload: (payload: ReviewPayload) => void; onComplete: () => void }) {
  const { notify } = useApp();
  const [name, setName] = useState(clientName);
  const [email, setEmail] = useState(clientEmail);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; note?: string }>({});

  useEffect(() => {
    if (!type) return;
    setName(clientName);
    setEmail(clientEmail);
    setNote('');
    setErrors({});
  }, [type, clientName, clientEmail]);

  if (!type) return null;
  const approved = type === 'approved';

  function update(field: 'name' | 'email' | 'note', value: string) {
    if (field === 'name') setName(value);
    else if (field === 'email') setEmail(value);
    else setNote(value);
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function validate() {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter a complete email address.';
    if (!approved && note.trim().length < 2) next.note = 'Summarize what needs to change.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const next = await api<ReviewPayload>(`/api/review/${token}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, revisionId, clientName: name, clientEmail: email, note }),
      });
      onPayload(next);
      onClose();
      notify(approved ? 'Revision approved' : 'Changes requested', approved ? 'A timestamped approval receipt has been generated.' : 'The studio has been notified with your decision note.');
      if (approved) window.setTimeout(onComplete, 180);
    } catch (error) {
      notify('Could not capture decision', error instanceof Error ? error.message : 'Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return <Modal open={Boolean(type)} onClose={onClose} title={approved ? 'Approve this revision' : 'Request another revision'} eyebrow={approved ? 'Final sign-off' : 'Decision note'}><form className="form-stack" onSubmit={submit} noValidate><div className={cn('decision-confirmation', approved ? 'is-approval' : 'is-changes')}><span>{approved ? <CheckCircle2 size={22} /> : <MessageSquare size={22} />}</span><div><strong>{approved ? `Approve ${project.name}` : 'Send clear change requests'}</strong><p>{approved ? 'Your decision will be tied to this exact revision and stored as an approval receipt.' : 'Summarize the remaining work so the next revision starts with clear direction.'}</p></div></div><div className="form-grid"><label className="field"><span>Your name</span><input value={name} onChange={(event) => update('name', event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'decision-name-error' : undefined} /><FieldError id="decision-name-error" message={errors.name} /></label><label className="field"><span>Email</span><input type="email" value={email} onChange={(event) => update('email', event.target.value)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'decision-email-error' : undefined} /><FieldError id="decision-email-error" message={errors.email} /></label></div><label className="field"><span>{approved ? 'Optional approval note' : 'What needs to change?'}</span><textarea rows={5} value={note} onChange={(event) => update('note', event.target.value)} required={!approved} placeholder={approved ? 'Approved for production.' : 'List the remaining changes in plain language.'} aria-invalid={Boolean(errors.note)} aria-describedby={errors.note ? 'decision-note-error' : undefined} /><FieldError id="decision-note-error" message={errors.note} /></label><div className="modal__footer"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className={cn('button', approved ? 'button--primary' : 'button--danger')} disabled={saving}>{saving ? 'Capturing…' : approved ? 'Confirm approval' : 'Request changes'}</button></div></form></Modal>;
}
