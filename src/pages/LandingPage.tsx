import {
  ArrowRight,
  Check,
  CheckCircle2,
  FileStack,
  LayoutDashboard,
  Link2,
  MessageSquare,
  Palette,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useApp } from '../state';
import { ThemeToggle } from '../components/ThemeToggle';

export function LandingPage() {
  const { state, auth, config } = useApp();

  const appName = config?.app.name ?? 'Pind';
  const appTagline = config?.app.tagline ?? 'Put feedback where the work is.';
  const reviewToken = state?.projects[0]?.reviewToken;

  return (
    <div className="marketing-page">
      <header className="marketing-nav">
        <Link to="/" className="brand-lockup brand-lockup--dark"><span className="brand-mark">P</span><span>{appName}</span></Link>
        <nav>
          <a href="#workflow">Workflow</a>
          <a href="#template">Template</a>
          <Link to="/design-system">Design system</Link>
          <ThemeToggle />
        </nav>
        {auth.configured ? (
          <Link className="button button--dark" to="/login">Sign in <ArrowRight size={16} /></Link>
        ) : (
          <Link className="button button--dark" to="/setup">Create workspace <ArrowRight size={16} /></Link>
        )}
      </header>

      <main>
        <section className="hero-section">
          <div className="hero-copy">
            <div className="hero-kicker"><span /> Remixable client review & approval portal</div>
            <h1>{appTagline}</h1>
            <p>{appName} gives creative teams one calm place to share revisions, pin precise feedback, capture approval, and hand off the final work.</p>
            <div className="hero-actions">
              {auth.configured ? (
                <Link className="button button--primary button--large" to="/login">Open your workspace <ArrowRight size={17} /></Link>
              ) : (
                <Link className="button button--primary button--large" to="/setup">Create your workspace <ArrowRight size={17} /></Link>
              )}
              {reviewToken ? (
                <Link className="button button--outline button--large" to={`/review/${reviewToken}`}>Enter as a client</Link>
              ) : (
                <Link className="button button--outline button--large" to="/design-system">View design system</Link>
              )}
            </div>
            <div className="hero-proof">
              <span><Check size={15} /> Seeded sample project</span>
              <span><Check size={15} /> Real review workflow</span>
              <span><Check size={15} /> Ready to remix</span>
            </div>
          </div>

          <div className="hero-product" aria-label="Pind product preview">
            <div className="hero-product__chrome"><span /><span /><span /><em>pind.app/review/ember-summer</em></div>
            <div className="hero-product__inner">
              <div className="mini-review-head">
                <span className="workspace-switcher__logo">N</span>
                <span><strong>Summer Packaging Redesign</strong><small>Revision 3 of 3</small></span>
                <span className="status status--in-review">In review</span>
              </div>
              <div className="mini-review-layout">
                <div className="mini-artboard">
                  <img src="/assets/ember-v3.svg" alt="Packaging design preview" />
                  <span className="pin pin--1">1</span>
                  <span className="pin pin--2">2</span>
                </div>
                <div className="mini-comments">
                  <div className="mini-comments__head"><strong>2 open comments</strong><MessageSquare size={15} /></div>
                  <article><span className="avatar avatar--sm">DO</span><p><strong>Dara</strong>Can we confirm the small origin text still passes print legibility?</p></article>
                  <article className="is-resolved"><span className="avatar avatar--sm">DO</span><p><strong>Dara</strong>The seasonal badge feels balanced now.</p><CheckCircle2 size={15} /></article>
                  {reviewToken ? (
                    <Link to={`/review/${reviewToken}`}>Approve revision <ArrowRight size={14} /></Link>
                  ) : (
                    <span className="mini-comments__hint">Demo review link appears after setup</span>
                  )}
                </div>
              </div>
            </div>
            <span className="hero-product__note hero-product__note--left"><MessageSquare size={16} /> Pinned feedback</span>
            <span className="hero-product__note hero-product__note--right"><ShieldCheck size={16} /> Approval receipt</span>
          </div>
        </section>

        <section className="logo-strip">
          <span>Built for</span><strong>Brand studios</strong><strong>Video teams</strong><strong>Freelancers</strong><strong>Agencies</strong><strong>Product designers</strong>
        </section>

        <section className="workflow-section" id="workflow">
          <div className="section-heading">
            <div className="eyebrow">The workflow</div>
            <h2>From "what did they mean?"<br />to a clean final sign-off.</h2>
            <p>Every screen has a job. Nothing is here merely to decorate the dashboard.</p>
          </div>
          <div className="workflow-grid">
            <article><span>01</span><div className="feature-icon"><FileStack size={21} /></div><h3>Share every revision</h3><p>Keep files, notes, version history, due dates, and milestones attached to the same project.</p></article>
            <article><span>02</span><div className="feature-icon"><MessageSquare size={21} /></div><h3>Pin feedback precisely</h3><p>Clients comment directly on the work. Teams resolve each point with a visible response.</p></article>
            <article><span>03</span><div className="feature-icon"><ShieldCheck size={21} /></div><h3>Capture the decision</h3><p>Approve or request changes against an exact revision, then retain a timestamped receipt.</p></article>
          </div>
        </section>

        <section className="template-section" id="template">
          <div className="template-panel">
            <div className="template-panel__copy">
              <div className="eyebrow">A real Replit template</div>
              <h2>Remix the system, not just the screenshot.</h2>
              <p>{appName} ships with a complete app surface, persistent data, integration adapters, realistic sample projects, and editable brand tokens.</p>
              <ul>
                <li><LayoutDashboard size={17} /><span><strong>Multi-screen workspace</strong>Dashboard, projects, clients, review portal, activity, settings, and receipts.</span></li>
                <li><Link2 size={17} /><span><strong>Connected by configuration</strong>PostgreSQL, Resend, Cloudinary, and Slack adapters with graceful fallbacks.</span></li>
                <li><Palette size={17} /><span><strong>Bundled design system</strong>Tokens, states, patterns, empty screens, dialogs, and responsive layouts.</span></li>
                <li><Sparkles size={17} /><span><strong>Seeded for the first run</strong>A convincing fictional studio and four projects appear automatically.</span></li>
              </ul>
              <Link to="/design-system" className="text-link">Inspect the design system <ArrowRight size={15} /></Link>
            </div>
            <div className="template-code-card">
              <div className="template-code-card__top"><span>Remix checklist</span><em>pind/replit.md</em></div>
              <div className="checklist-row is-done"><CheckCircle2 size={17} /><span>Sample workspace seeded</span><code>ready</code></div>
              <div className="checklist-row is-done"><CheckCircle2 size={17} /><span>Database adapter</span><code>ready</code></div>
              <div className="checklist-row is-done"><CheckCircle2 size={17} /><span>Email invitations</span><code>ready</code></div>
              <div className="checklist-row is-done"><CheckCircle2 size={17} /><span>File uploads</span><code>ready</code></div>
              <div className="checklist-row is-done"><CheckCircle2 size={17} /><span>Brand customizer</span><code>ready</code></div>
              <div className="code-foot">Add credentials only when you need them. The demo remains explorable without setup.</div>
            </div>
          </div>
        </section>

        <section className="final-cta">
          <span className="brand-mark brand-mark--large">P</span>
          <div><div className="eyebrow">Northstar Creative demo</div><h2>One project. Three revisions.<br />No missing context.</h2></div>
          {auth.configured ? (
            <Link to="/login" className="button button--light button--large">Sign in to explore <ArrowRight size={17} /></Link>
          ) : (
            <Link to="/setup" className="button button--light button--large">Create workspace & explore <ArrowRight size={17} /></Link>
          )}
        </section>
      </main>
      <footer className="marketing-footer"><span>© 2026 {appName} template</span><span>Built for the Replit Buildathon</span><Link to={auth.configured ? '/login' : '/setup'}>{auth.configured ? 'Sign in' : 'Create workspace'}</Link></footer>
    </div>
  );
}
