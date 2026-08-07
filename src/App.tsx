import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectPage } from './pages/ProjectPage';
import { ReviewPage } from './pages/ReviewPage';
import { ClientsPage } from './pages/ClientsPage';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { AppShell } from './components/AppShell';
import { ToastRegion } from './components/ToastRegion';
import { useApp } from './state';

/** Public routes that render without authentication. */
function isPublicPath(pathname: string) {
  return pathname === '/' ||
    pathname.startsWith('/review/') ||
    pathname === '/design-system';
}

function StudioRoutes() {
  const { state, auth } = useApp();
  const location = useLocation();

  // Review links are standalone and never touch the studio auth gate.
  if (location.pathname.startsWith('/review/')) return <ReviewPage />;

  if (!auth.configured) {
    return <Navigate to="/setup" replace />;
  }
  if (!auth.authenticated || !state) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Routes>
      <Route path="/app" element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="/design-system" element={<DesignSystemPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function App() {
  const { loading, error, refresh, auth } = useApp();
  const location = useLocation();
  const isReview = location.pathname.startsWith('/review/');

  if (loading && !isReview) {
    return (
      <div className="boot-screen">
        <div className="brand-mark brand-mark--large">P</div>
        <div className="boot-line"><span /></div>
        <p>Loading Pind</p>
      </div>
    );
  }

  if (error && !isReview) {
    return (
      <div className="error-screen">
        <div className="brand-mark">P</div>
        <h1>Pind could not open the workspace.</h1>
        <p>{error}</p>
        <button className="button button--primary" onClick={() => void refresh()}>Try again</button>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/review/:token" element={<ReviewPage />} />
        <Route path="/design-system" element={<DesignSystemPage />} />
        <Route path="/setup" element={auth.configured ? <Navigate to="/login" replace /> : <SetupPage />} />
        <Route path="/login" element={auth.authenticated ? <Navigate to="/app" replace /> : <LoginPage />} />
        <Route path="/app/*" element={<StudioRoutes />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <ToastRegion />
    </>
  );
}