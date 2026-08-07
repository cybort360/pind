import {
  Activity,
  ArrowUpRight,
  Bell,
  Boxes,
  ChevronDown,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { cn, relativeDate } from '../lib';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

const navItems = [
  { to: '/app', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/app/projects', label: 'Projects', icon: FolderKanban },
  { to: '/app/clients', label: 'Clients', icon: Users },
  { to: '/app/activity', label: 'Activity', icon: Activity },
];

const pageTitles: Record<string, string> = {
  '/app': 'Overview',
  '/app/projects': 'Projects',
  '/app/clients': 'Clients',
  '/app/activity': 'Activity',
  '/app/settings': 'Workspace settings',
};

export function AppShell() {
  const { state, setState, logout } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape' && notificationsOpen) setNotificationsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notificationsOpen]);

  const title = useMemo(() => {
    if (pageTitles[location.pathname]) return pageTitles[location.pathname];
    if (location.pathname.startsWith('/app/projects/')) {
      const id = location.pathname.split('/').pop();
      return state?.projects.find((project) => project.id === id)?.name ?? 'Project';
    }
    return 'Pind';
  }, [location.pathname, state?.projects]);

  const searchResults = useMemo(() => {
    const projects = state?.projects ?? [];
    const clients = state?.clients ?? [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return { projects: projects.slice(0, 4), clients: clients.slice(0, 3) };
    return {
      projects: projects.filter((project) => `${project.name} ${project.clientName} ${project.category}`.toLowerCase().includes(query)).slice(0, 6),
      clients: clients.filter((client) => `${client.name} ${client.company} ${client.email}`.toLowerCase().includes(query)).slice(0, 4),
    };
  }, [searchQuery, state?.clients, state?.projects]);

  if (!state) return null;
  const unread = state.notifications.filter((item) => !item.read).length;

  async function markRead(id: string, projectId?: string) {
    const response = await fetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
    if (response.ok) {
      const next = await response.json();
      setState(next);
      setNotificationsOpen(false);
      if (projectId) navigate(`/app/projects/${projectId}`);
    }
  }

  return (
    <div className="app-shell">
      <aside className={cn('sidebar', mobileOpen && 'sidebar--open')}>
        <div className="sidebar__brand">
          <NavLink to="/app" className="brand-lockup" onClick={() => setMobileOpen(false)}>
            <span className="brand-mark">P</span>
            <span>Pind</span>
          </NavLink>
          <button className="icon-button sidebar__close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>

        <button className="workspace-switcher" onClick={() => setWorkspaceOpen((value) => !value)} aria-expanded={workspaceOpen} aria-haspopup="menu">
          <span className="workspace-switcher__logo">{state.workspace.logoText}</span>
          <span>
            <strong>{state.workspace.shortName}</strong>
            <small>{state.workspace.name}</small>
          </span>
          <ChevronDown size={16} />
        </button>
        {workspaceOpen && (
          <div className="workspace-menu" role="menu" aria-label="Workspace menu">
            <button onClick={() => { navigate('/app/settings'); setWorkspaceOpen(false); }}><Settings size={15} /> Workspace settings</button>
            <button onClick={() => { navigate('/design-system'); setWorkspaceOpen(false); }}><Palette size={15} /> Design system</button>
            <div className="workspace-menu__divider" />
            <button onClick={() => { void logout().then(() => navigate('/login', { replace: true })); setWorkspaceOpen(false); }}><LogOut size={15} /> Sign out</button>
          </div>
        )}

        <nav className="sidebar__nav">
          <div className="sidebar__label">Workspace</div>
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) => cn('sidebar__link', isActive && 'is-active')}
            >
              <Icon size={18} />
              <span>{label}</span>
              {label === 'Projects' && <em>{state.projects.filter((project) => project.status !== 'approved').length}</em>}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__spacer" />
        <div className="sidebar__nav sidebar__nav--bottom">
          <NavLink to="/design-system" className="sidebar__link"><Boxes size={18} /><span>Design system</span></NavLink>
          <NavLink to="/app/settings" className={({ isActive }) => cn('sidebar__link', isActive && 'is-active')}><Settings size={18} /><span>Settings</span></NavLink>
        </div>
        <div className="sidebar__profile">
          <Avatar name={state.owner?.name ?? state.workspace.name} size="sm" />
          <span><strong>{state.owner?.name ?? 'Workspace'}</strong><small>{state.owner?.demo ? 'Demo workspace' : 'Workspace owner'}</small></span>
          <button className="icon-button" aria-label="Open workspace settings" onClick={() => navigate('/app/settings')}><ChevronDown size={15} /></button>
        </div>
      </aside>

      {mobileOpen && <button className="sidebar-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}

      <main className="app-main" id="main">
        <a className="skip-link" href="#page-content">Skip to content</a>
        <header className="topbar">
          <div className="topbar__left">
            <button className="icon-button topbar__menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
            <div>
              <div className="topbar__eyebrow">{state.workspace.shortName}</div>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="topbar__actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-haspopup="dialog" aria-label="Search workspace">
              <Search size={17} /><span>Search anything</span><kbd>⌘ K</kbd>
            </button>
            <div className="popover-anchor">
              <button className="icon-button icon-button--bordered" onClick={() => setNotificationsOpen((value) => !value)} aria-label="Notifications" aria-expanded={notificationsOpen} aria-haspopup="true">
                <Bell size={18} />
                {unread > 0 && <span className="notification-dot">{unread}</span>}
              </button>
              {notificationsOpen && (
                <div className="popover notification-popover" role="dialog" aria-label="Notifications">
                  <div className="popover__header"><strong>Notifications</strong><span>{unread} unread</span><button className="icon-button" onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={14} /></button></div>
                  <div className="notification-list">
                    {state.notifications.map((item) => (
                      <button key={item.id} className={cn('notification-item', !item.read && 'is-unread')} onClick={() => void markRead(item.id, item.projectId)}>
                        <span className="notification-item__dot" />
                        <span><strong>{item.title}</strong><small>{item.body}</small><em>{relativeDate(item.createdAt)}</em></span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Avatar name="Maya Okeke" size="sm" />
          </div>
        </header>
        <div className="page-container" id="page-content"><Outlet /></div>
      </main>
      <Modal open={searchOpen} onClose={() => { setSearchOpen(false); setSearchQuery(''); }} title="Search workspace" eyebrow="Command menu" size="lg">
        <div className="command-search">
          <label><Search size={18} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search projects, clients, or categories" /><kbd>ESC</kbd></label>
          <div className="command-search__group"><span>Projects</span>{searchResults.projects.map((project) => <button key={project.id} onClick={() => { navigate(`/app/projects/${project.id}`); setSearchOpen(false); setSearchQuery(''); }}><span><strong>{project.name}</strong><small>{project.clientName} · {project.category}</small></span><ArrowUpRight size={15} /></button>)}{!searchResults.projects.length && <em>No matching projects</em>}</div>
          <div className="command-search__group"><span>Clients</span>{searchResults.clients.map((client) => <button key={client.id} onClick={() => { navigate('/app/clients'); setSearchOpen(false); setSearchQuery(''); }}><span><strong>{client.company}</strong><small>{client.name} · {client.email}</small></span><ArrowUpRight size={15} /></button>)}{!searchResults.clients.length && <em>No matching clients</em>}</div>
        </div>
      </Modal>
    </div>
  );
}
