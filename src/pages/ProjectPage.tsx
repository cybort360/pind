import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  File,
  FileCheck2,
  FileUp,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Send,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { AppState, Comment, Revision } from '@shared/types';
import { useApp } from '../state';
import { api, cn, formatDate, relativeDate } from '../lib';
import { StatusBadge } from '../components/StatusBadge';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { DecisionReceipt } from '../components/DecisionReceipt';

export function ProjectPage() {
  const { projectId } = useParams();
  const { state, setState, notify } = useApp();
  const [tab, setTab] = useState<'review' | 'overview' | 'files' | 'timeline'>('review');
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>('');
  const [commentFilter, setCommentFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [pinDraft, setPinDraft] = useState<{ x: number; y: number } | null>(null);
  const [commentBody, setCommentBody] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<Comment | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!state) return null;
  const project = state.projects.find((item) => item.id === projectId);
  if (!project) return <div className="not-found-panel"><h2>Project not found</h2><Link to="/app/projects" className="button button--outline">Back to projects</Link></div>;

  const selectedRevision = project.revisions.find((item) => item.id === selectedRevisionId) ?? project.revisions.at(-1);
  const visibleComments = project.comments.filter((comment) => {
    if (selectedRevision && comment.revisionId !== selectedRevision.id) return false;
    return commentFilter === 'all' || comment.status === commentFilter;
  });
  const pinnedCommentNumbers = new Map(
    visibleComments
      .filter((comment) => comment.x !== undefined && comment.y !== undefined)
      .map((comment, index) => [comment.id, index + 1]),
  );
  const latestDecision = project.decisions[0];
  const latestDecisionRevision = project.revisions.find((item) => item.id === latestDecision?.revisionId);
  const client = state.clients.find((item) => item.id === project.clientId);
  const stableProjectId = project.id;
  const reviewUrl = `${window.location.origin}/review/${project.reviewToken}`;

  const openFeedback = project.comments.filter((comment) => comment.status === 'open').map((comment) => comment.body);
  const revisionSummary = openFeedback.length
    ? `${openFeedback.length} open ${openFeedback.length === 1 ? 'point' : 'points'}: ${openFeedback.slice(0, 2).join(' · ')}${openFeedback.length > 2 ? ` · plus ${openFeedback.length - 2} more` : ''}`
    : 'No open feedback. This revision is ready for a client decision.';

  async function addComment() {
    if (!selectedRevision || !commentBody.trim()) return;
    const authorName = state!.owner?.name ?? 'Studio';
    setSaving(true);
    try {
      const next = await api<AppState>(`/api/projects/${stableProjectId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revisionId: selectedRevision.id,
          author: authorName,
          authorRole: 'studio',
          body: commentBody,
          x: pinDraft?.x,
          y: pinDraft?.y,
        }),
      });
      setState(next);
      setCommentBody('');
      setPinDraft(null);
      notify('Comment added', 'The feedback is attached to this exact revision.');
    } catch (error) {
      notify('Could not add comment', error instanceof Error ? error.message : 'Try again.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function resolveComment(id: string, reply: string) {
    try {
      const next = await api<AppState>(`/api/comments/${id}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply }),
      });
      setState(next);
      notify('Feedback resolved', 'The client can see how the point was handled.');
    } catch (error) {
      notify('Could not resolve feedback', error instanceof Error ? error.message : 'Try again.', 'error');
    }
  }

  async function copyReviewLink() {
    await navigator.clipboard.writeText(reviewUrl);
    notify('Review link copied', 'The link is scoped to this client project.');
  }

  function onCanvasClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!selectedRevision) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setPinDraft({ x, y });
    setCommentBody('');
  }

  function onCanvasKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (!selectedRevision) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setPinDraft({ x: 50, y: 50 });
    setCommentBody('');
  }

  return (
    <div className="project-page">
      <section className="project-header">
        <div className="project-header__title">
          <Link to="/app/projects" className="icon-button"><ArrowLeft size={18} /></Link>
          <div><div className="project-header__meta"><span>{project.clientName}</span><span>•</span><span>{project.category}</span></div><h2>{project.name}</h2></div>
          <StatusBadge status={project.status} />
        </div>
        <div className="project-header__actions">
          <button className="button button--outline" onClick={() => setInviteOpen(true)}><Share2 size={16} /> Share review</button>
          <button className="button button--primary" onClick={() => setUploadOpen(true)}><FileUp size={16} /> Upload revision</button>
          <div className="popover-anchor"><button className="icon-button icon-button--bordered" onClick={() => setMoreOpen((value) => !value)}><MoreHorizontal size={18} /></button>{moreOpen && <div className="popover mini-menu"><button onClick={() => void copyReviewLink()}><Copy size={15} /> Copy review link</button><button onClick={() => window.open(reviewUrl, '_blank')}><ExternalLink size={15} /> Open client portal</button>{latestDecision && <button onClick={() => setReceiptOpen(true)}><FileCheck2 size={15} /> View latest receipt</button>}</div>}</div>
        </div>
      </section>

      <nav className="project-tabs">
        {(['review', 'overview', 'files', 'timeline'] as const).map((item) => <button className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)} key={item}>{item[0].toUpperCase() + item.slice(1)}{item === 'review' && <em>{project.comments.filter((comment) => comment.status === 'open').length}</em>}</button>)}
      </nav>

      {tab === 'review' && (
        <div className="review-workspace">
          <section className="review-stage">
            <header className="review-stage__toolbar">
              <div className="revision-select-wrap">
                <small>Viewing</small>
                <select value={selectedRevision?.id ?? ''} onChange={(event) => setSelectedRevisionId(event.target.value)} disabled={!project.revisions.length}>
                  {project.revisions.slice().reverse().map((revision) => <option key={revision.id} value={revision.id}>V{revision.version} · {revision.label}</option>)}
                </select>
                <ChevronDown size={15} />
              </div>
              <div className="review-stage__details">{selectedRevision && <><span>{selectedRevision.fileName}</span><span>{selectedRevision.sizeLabel}</span><span>Uploaded {relativeDate(selectedRevision.uploadedAt)}</span></>}</div>
              <div className="review-stage__actions">{selectedRevision && <a className="icon-button" href={selectedRevision.fileUrl} download aria-label="Download file"><Download size={17} /></a>}<button className="button button--outline button--compact" onClick={() => window.open(reviewUrl, '_blank')}>Client view <ExternalLink size={14} /></button></div>
            </header>

            {selectedRevision ? (
              <div className="artboard-wrap">
                <div className="artboard-instruction"><MessageSquare size={14} /> Click anywhere on the work to pin feedback</div>
                <div className="artboard" onClick={onCanvasClick} onKeyDown={onCanvasKeyDown} role="button" tabIndex={0} aria-label="Artwork. Press Enter or Space to add a feedback pin, or click to place one at that point.">
                  {selectedRevision.kind === 'image' || selectedRevision.thumbnail ? <img src={selectedRevision.thumbnail ?? selectedRevision.fileUrl} alt={selectedRevision.label} /> : <div className="file-preview"><File size={42} /><strong>{selectedRevision.fileName}</strong><span>{selectedRevision.kind.toUpperCase()} · {selectedRevision.sizeLabel}</span><a href={selectedRevision.fileUrl}>Open file</a></div>}
                  {visibleComments.filter((comment) => comment.x !== undefined && comment.y !== undefined).map((comment) => <button key={comment.id} aria-label={`Comment ${pinnedCommentNumbers.get(comment.id)}: ${comment.body}`} title={comment.body} className={cn('pin', comment.status === 'resolved' && 'pin--resolved')} style={{ left: `${comment.x}%`, top: `${comment.y}%` }} onClick={(event) => { event.stopPropagation(); document.getElementById(`comment-${comment.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>{pinnedCommentNumbers.get(comment.id)}</button>)}
                  {pinDraft && <span className="pin pin--draft" style={{ left: `${pinDraft.x}%`, top: `${pinDraft.y}%` }}>+</span>}
                </div>
                <div className="revision-note"><strong>Revision note</strong><p>{selectedRevision.note || 'No note was added to this revision.'}</p></div>
              </div>
            ) : (
              <div className="first-upload"><FileUp size={26} /><h3>Upload the first revision</h3><p>The review canvas, comments, and client link activate as soon as a file is added.</p><button className="button button--primary" onClick={() => setUploadOpen(true)}>Choose a file</button></div>
            )}
          </section>

          <aside className="comments-panel">
            <header className="comments-panel__head"><div><h3>Feedback</h3><p>{project.comments.filter((comment) => comment.status === 'open').length} open across all revisions</p></div><div className="comment-filter"><button className={commentFilter === 'all' ? 'is-active' : ''} onClick={() => setCommentFilter('all')}>All</button><button className={commentFilter === 'open' ? 'is-active' : ''} onClick={() => setCommentFilter('open')}>Open</button><button className={commentFilter === 'resolved' ? 'is-active' : ''} onClick={() => setCommentFilter('resolved')}>Done</button></div></header>
            <div className="summary-card"><span><Sparkles size={15} /></span><div><strong>Revision brief</strong><p>{revisionSummary}</p></div></div>
            <div className="comments-list">
              {visibleComments.map((comment) => (
                <article id={`comment-${comment.id}`} className={cn('comment-card', comment.status === 'resolved' && 'comment-card--resolved')} key={comment.id}>
                  <div className="comment-card__top"><Avatar name={comment.author} size="sm" /><div><strong>{comment.author}</strong><span>{comment.authorRole === 'client' ? 'Client' : 'Studio'} · {relativeDate(comment.createdAt)}</span></div>{pinnedCommentNumbers.has(comment.id) && <em>{pinnedCommentNumbers.get(comment.id)}</em>}</div>
                  <p>{comment.body}</p>
                  {comment.reply && <div className="comment-reply"><Avatar name={state.owner?.name ?? 'Studio'} size="sm" /><p><strong>{state.owner?.name ?? 'Studio'}</strong>{comment.reply}</p></div>}
                  <div className="comment-card__foot">{comment.status === 'open' ? <button onClick={() => setResolveTarget(comment)}><Check size={14} /> Mark resolved</button> : <span><CheckCircle2 size={14} /> Resolved {comment.resolvedAt ? relativeDate(comment.resolvedAt) : ''}</span>}</div>
                </article>
              ))}
              {!visibleComments.length && <div className="comments-empty"><MessageSquare size={20} /><strong>No feedback here yet.</strong><span>Click the artwork or write a general comment below.</span></div>}
            </div>
            {selectedRevision && <div className="comment-composer">{pinDraft && <div className="pin-context"><span>+</span> New pin at {Math.round(pinDraft.x)}%, {Math.round(pinDraft.y)}%<button onClick={() => setPinDraft(null)}><X size={13} /></button></div>}<textarea rows={3} placeholder={pinDraft ? 'Describe what should change at this point…' : 'Add a general note for this revision…'} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} /><div><span>Commenting as {state.owner?.name ?? 'Studio'}</span><button className="button button--primary button--compact" onClick={() => void addComment()} disabled={!commentBody.trim() || saving}>{saving ? 'Adding…' : <><Send size={14} /> Add comment</>}</button></div></div>}
          </aside>
        </div>
      )}

      {tab === 'overview' && (
        <div className="overview-grid">
          <section className="panel project-summary-card"><div className="eyebrow">Project brief</div><h3>{project.name}</h3><p>{project.description}</p><div className="summary-facts"><div><small>Client</small><strong>{client?.name}</strong><span>{client?.company}</span></div><div><small>Owner</small><strong>{project.owner}</strong><span>Creative lead</span></div><div><small>Budget</small><strong>{project.budgetLabel}</strong><span>Project value</span></div><div><small>Due date</small><strong>{formatDate(project.dueAt, 'MMM d, yyyy')}</strong><span>{project.progress}% complete</span></div></div></section>
          <section className="panel milestone-panel"><header className="panel__header"><div><h3>Milestones</h3><p>The path from kickoff to handoff.</p></div></header><div className="milestone-list">{project.milestones.map((milestone) => <article key={milestone.id} className={`milestone milestone--${milestone.status}`}><span>{milestone.status === 'complete' ? <Check size={14} /> : milestone.status === 'current' ? <Clock3 size={14} /> : null}</span><div><strong>{milestone.title}</strong><small>{formatDate(milestone.dueAt)}</small></div><em>{milestone.status}</em></article>)}</div></section>
          <section className="panel decision-panel"><header className="panel__header"><div><h3>Decision history</h3><p>Every sign-off stays attached to a revision.</p></div></header>{project.decisions.length ? project.decisions.map((decision) => <button className="decision-row" key={decision.id} onClick={() => setReceiptOpen(true)}><span className={`decision-row__icon decision-row__icon--${decision.type}`}>{decision.type === 'approved' ? <CheckCircle2 size={17} /> : <X size={17} />}</span><div><strong>{decision.type === 'approved' ? 'Approved' : 'Changes requested'} by {decision.clientName}</strong><small>{formatDate(decision.createdAt, 'MMM d, yyyy · h:mm a')} · {decision.receiptCode}</small></div><ExternalLink size={15} /></button>) : <div className="mini-empty"><FileCheck2 size={19} /><span>No client decision has been captured yet.</span></div>}</section>
        </div>
      )}

      {tab === 'files' && (
        <section className="panel files-panel"><header className="panel__header"><div><h3>Revision library</h3><p>All files remain grouped by project.</p></div><button className="button button--primary button--compact" onClick={() => setUploadOpen(true)}><Plus size={15} /> Add revision</button></header><div className="file-table"><div className="file-table__head"><span>Revision</span><span>Uploaded</span><span>Size</span><span>Feedback</span><span /></div>{project.revisions.slice().reverse().map((revision) => <div className="file-table__row" key={revision.id}><span className="file-name-cell"><span className="file-type"><File size={17} /></span><span><strong>V{revision.version} · {revision.label}</strong><small>{revision.fileName}</small></span></span><span>{relativeDate(revision.uploadedAt)}<small>{revision.uploadedBy}</small></span><span>{revision.sizeLabel}</span><span>{project.comments.filter((comment) => comment.revisionId === revision.id).length} comments</span><a href={revision.fileUrl} download className="icon-button"><Download size={16} /></a></div>)}</div></section>
      )}

      {tab === 'timeline' && (
        <section className="panel timeline-panel"><header className="panel__header"><div><h3>Project timeline</h3><p>A chronological record of uploads, feedback, and decisions.</p></div></header><div className="timeline-list">{state.activities.filter((activity) => activity.projectId === project.id).map((activity) => <article key={activity.id}><span className={`timeline-dot timeline-dot--${activity.type}`} /><div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{activity.actor} · {formatDate(activity.createdAt, 'MMM d, yyyy · h:mm a')}</small></div></article>)}</div></section>
      )}

      <UploadRevisionModal open={uploadOpen} onClose={() => setUploadOpen(false)} project={project} fileRef={fileRef} />
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} project={project} reviewUrl={reviewUrl} clientEmail={client?.email ?? ''} />
      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} title="Decision record" eyebrow="Audit trail" size="lg">{latestDecision ? <DecisionReceipt project={project} decision={latestDecision} revision={latestDecisionRevision} workspace={state.workspace} /> : <div className="mini-empty"><FileCheck2 size={20} /><span>No receipt is available yet.</span></div>}</Modal>
      <ResolveDialog comment={resolveTarget} onClose={() => setResolveTarget(null)} onResolve={resolveComment} />
    </div>
  );
}

function UploadRevisionModal({ open, onClose, project, fileRef }: { open: boolean; onClose: () => void; project: { id: string; revisions: Revision[] }; fileRef: React.RefObject<HTMLInputElement> }) {
  const { setState, notify } = useApp();
  const [label, setLabel] = useState(`Revision ${project.revisions.length + 1}`);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('label', label);
      body.append('note', note);
      const next = await api<AppState>(`/api/projects/${project.id}/revisions`, { method: 'POST', body });
      setState(next);
      notify('Revision uploaded', 'The client review link now points to the latest work.');
      setFile(null); setNote(''); onClose();
    } catch (error) {
      notify('Upload failed', error instanceof Error ? error.message : 'Try again.', 'error');
    } finally {
      setUploading(false);
    }
  }

  return <Modal open={open} onClose={onClose} title="Upload a new revision" eyebrow={`Version ${project.revisions.length + 1}`}><form className="form-stack" onSubmit={upload}><button type="button" className={cn('upload-dropzone', file && 'has-file')} onClick={() => fileRef.current?.click()}>{file ? <><FileCheck2 size={25} /><strong>{file.name}</strong><span>{(file.size / (1024 * 1024)).toFixed(1)} MB · Click to replace</span></> : <><FileUp size={25} /><strong>Choose a deliverable</strong><span>Images, PDFs, video, or project files up to 25 MB</span></>}<input ref={fileRef} type="file" hidden onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></button><label className="field"><span>Revision label</span><input value={label} onChange={(event) => setLabel(event.target.value)} required /></label><label className="field"><span>What changed?</span><textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Summarize the changes so the client knows where to focus." /></label><div className="integration-hint"><span className="integration-hint__dot" /><p><strong>Storage adapter</strong>Cloudinary is used when configured; local storage keeps the demo functional otherwise.</p></div><div className="modal__footer"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={!file || uploading}>{uploading ? 'Uploading…' : 'Upload revision'}</button></div></form></Modal>;
}

function InviteModal({ open, onClose, project, reviewUrl, clientEmail }: { open: boolean; onClose: () => void; project: { id: string; name: string }; reviewUrl: string; clientEmail: string }) {
  const { setState, notify } = useApp();
  const [email, setEmail] = useState(clientEmail);
  const [message, setMessage] = useState(`The latest revision of ${project.name} is ready. Please add feedback or approve it when everything looks right.`);
  const [sending, setSending] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault(); setSending(true);
    try {
      const result = await api<{ state: AppState; sent: boolean; reviewUrl: string }>(`/api/projects/${project.id}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, message }) });
      setState(result.state);
      await navigator.clipboard.writeText(result.reviewUrl);
      notify(result.sent ? 'Invitation sent' : 'Review link copied', result.sent ? `An email was sent to ${email}.` : 'Add RESEND_API_KEY to send invitations; the link is on your clipboard.');
      onClose();
    } catch (error) { notify('Could not prepare invitation', error instanceof Error ? error.message : 'Try again.', 'error'); }
    finally { setSending(false); }
  }

  return <Modal open={open} onClose={onClose} title="Share the client review" eyebrow="Secure project link"><form className="form-stack" onSubmit={send}><label className="field"><span>Client email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label className="field"><span>Message</span><textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} /></label><div className="copy-field"><Link2 size={16} /><span>{reviewUrl}</span><button type="button" onClick={() => navigator.clipboard.writeText(reviewUrl)}><Copy size={15} /></button></div><div className="modal__footer"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={sending}>{sending ? 'Preparing…' : <><Send size={15} /> Send invitation</>}</button></div></form></Modal>;
}

function ResolveDialog({ comment, onClose, onResolve }: { comment: Comment | null; onClose: () => void; onResolve: (id: string, reply: string) => Promise<void> }) {
  const [reply, setReply] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (comment) setReply(comment.reply ?? 'Updated in the latest revision.');
  }, [comment]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!comment) return;
    setSaving(true);
    try {
      await onResolve(comment.id, reply);
      onClose();
    } catch {
      setSaving(false);
    }
  }

  return (
    <Modal open={Boolean(comment)} onClose={onClose} title="Resolve feedback" eyebrow="Studio response">
      {comment && (
        <form className="form-stack" onSubmit={submit}>
          <div className="summary-card"><span><MessageSquare size={15} /></span><div><strong>Client feedback</strong><p>{comment.body}</p></div></div>
          <label className="field"><span>Resolution note</span><textarea rows={3} required maxLength={400} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Tell the client how this point was handled." /></label>
          <p className="field-hint">This note is shown to the client in the review portal.</p>
          <div className="modal__footer"><button type="button" className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--primary" disabled={!reply.trim() || saving}>{saving ? 'Resolving…' : <><Check size={15} /> Resolve feedback</>}</button></div>
        </form>
      )}
    </Modal>
  );
}
