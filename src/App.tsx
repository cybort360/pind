import { Navigate, Route, Routes } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectPage } from './pages/ProjectPage';
import { ReviewPage } from './pages/ReviewPage';
import { ClientsPage } from './pages/ClientsPage';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';
import { DesignSystemPage } from './pages/DesignSystemPage';
import { AppShell } from './components/AppShell';
import { ToastRegion } from './components/ToastRegion';
import { useApp } from './state';

export function App() {
  const { loading, error, refresh } = useApp();

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="brand-mark brand-mark--large">P</div>
        <div className="boot-line"><span /></div>
        <p>Preparing the workspace</p>
      </div>
    );
  }

  if (error) {
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
        <Route path="/app" element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:projectId" element={<ProjectPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastRegion />
    </>
  );
}
