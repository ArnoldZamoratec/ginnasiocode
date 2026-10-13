import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import '@fontsource/big-shoulders-display/latin-700';
import '@fontsource/big-shoulders-display/latin-800';
import '@fontsource/big-shoulders-display/latin-900';
import '@fontsource/ibm-plex-sans/latin-400';
import '@fontsource/ibm-plex-sans/latin-500';
import '@fontsource/ibm-plex-sans/latin-600';
import '@fontsource/ibm-plex-mono/latin-500';
import '@fontsource/ibm-plex-mono/latin-600';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { configureFormat } from './lib/format.ts';
import { ToastProvider, Skeleton } from './components/ui.tsx';
import { MemberShell, StaffShell, homeFor } from './components/Shell.tsx';
import { Login } from './pages/Login.tsx';
import { MemberHome } from './pages/member/Home.tsx';
import { MemberPass } from './pages/member/Pass.tsx';
import { MemberClasses } from './pages/member/Classes.tsx';
import { MemberTraining } from './pages/member/Training.tsx';
import { WorkoutMode } from './pages/member/Workout.tsx';
import { MemberAccount } from './pages/member/Account.tsx';
import { CheckinPage } from './pages/staff/Checkin.tsx';
import { MembersPage } from './pages/staff/Members.tsx';
import { MemberDetailPage } from './pages/staff/MemberDetail.tsx';
import { CashPage } from './pages/staff/Cash.tsx';
import { StaffClasses } from './pages/staff/Classes.tsx';
import { TrainerHome } from './pages/staff/TrainerHome.tsx';
import { RoutinesPage } from './pages/staff/Routines.tsx';
import { ExercisesPage } from './pages/staff/Exercises.tsx';
import { Dashboard } from './pages/admin/Dashboard.tsx';
import { PlansPage } from './pages/admin/Plans.tsx';
import { SchedulePage } from './pages/admin/Schedule.tsx';
import { BranchesPage } from './pages/admin/Branches.tsx';
import { StaffPage } from './pages/admin/Staff.tsx';
import { TemplatesPage } from './pages/admin/Templates.tsx';
import { SettingsPage } from './pages/admin/Settings.tsx';
import { AuditPage } from './pages/admin/Audit.tsx';
import { NotFound } from './pages/NotFound.tsx';

function ScrollTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function App() {
  const { user, ready, settings } = useAuth();
  useEffect(() => { if (settings) configureFormat(settings); }, [settings]);

  if (!ready) return <div className="page"><Skeleton block lines={3} /></div>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;

  if (user.role === 'member') {
    return (
      <Routes>
        <Route path="/entreno/sesion/:id" element={<WorkoutMode />} />
        <Route element={<MemberShell />}>
          <Route index element={<MemberHome />} />
          <Route path="pase" element={<MemberPass />} />
          <Route path="clases" element={<MemberClasses />} />
          <Route path="entreno" element={<MemberTraining />} />
          <Route path="cuenta" element={<MemberAccount />} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    );
  }

  const admin = user.role === 'admin';
  const desk = user.role === 'reception' || admin;
  const coach = user.role === 'trainer' || admin;
  return (
    <Routes>
      <Route element={<StaffShell />}>
        <Route index element={<Navigate to={homeFor(user.role)} replace />} />
        <Route path="login" element={<Navigate to={homeFor(user.role)} replace />} />
        {admin && <Route path="panel" element={<Dashboard />} />}
        {desk && <Route path="recepcion" element={<CheckinPage />} />}
        {desk && <Route path="caja" element={<CashPage />} />}
        <Route path="socios" element={user.role === 'trainer' ? <Navigate to="/entrenador" replace /> : <MembersPage />} />
        <Route path="socios/:id" element={<MemberDetailPage />} />
        <Route path="clases" element={<StaffClasses />} />
        {coach && <Route path="entrenador" element={<TrainerHome />} />}
        {coach && <Route path="rutinas" element={<RoutinesPage />} />}
        {coach && <Route path="ejercicios" element={<ExercisesPage />} />}
        {admin && (
          <Route path="admin">
            <Route path="planes" element={<PlansPage />} />
            <Route path="horario" element={<SchedulePage />} />
            <Route path="sedes" element={<BranchesPage />} />
            <Route path="personal" element={<StaffPage />} />
            <Route path="avisos" element={<TemplatesPage />} />
            <Route path="ajustes" element={<SettingsPage />} />
            <Route path="auditoria" element={<AuditPage />} />
          </Route>
        )}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ScrollTop />
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
