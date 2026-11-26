import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { PolicyGate } from './components/policy';
import { EmailGate } from './components/auth/EmailGate';
import { ModalProvider, RadioProvider, TooltipProvider, useTooltip } from './context';
import { DashboardLoadingSkeleton } from './pages/dashboard/DashboardLoadingSkeleton';
import { parseDashboardPath } from './lib/dashboardRoutes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- preload wrapper accepts any component
function lazyWithPreload<T extends React.ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  const Component = lazy(factory) as React.LazyExoticComponent<T> & { preload: () => Promise<{ default: T }> };
  Component.preload = factory;
  return Component;
}

const AuthPage = lazyWithPreload(() => import('./pages/auth/AuthPage').then((m) => ({ default: m.AuthPage })));
const DashboardPage = lazyWithPreload(() => import('./pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ProfilePage = lazyWithPreload(() => import('./pages/dashboard/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const PoliciesPage = lazyWithPreload(() => import('./pages/policies/PoliciesPage').then((m) => ({ default: m.PoliciesPage })));
const TermsPage = lazyWithPreload(() => import('./pages/policies/TermsPage').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazyWithPreload(() => import('./pages/policies/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const RefundPage = lazyWithPreload(() => import('./pages/policies/RefundPage').then((m) => ({ default: m.RefundPage })));
const LandingPage = lazyWithPreload(() => import('./pages/landing/LandingPage').then((m) => ({ default: m.LandingPage })));
const LinkPage = lazyWithPreload(() => import('./pages/link/LinkPage').then((m) => ({ default: m.LinkPage })));
const NotFoundPage = lazyWithPreload(() => import('./pages/notFound/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

// eslint-disable-next-line react-refresh/only-export-components -- route preload registry used by dashboard prefetch
export const routePreloads = {
  landing: () => LandingPage.preload(),
  auth: () => AuthPage.preload(),
  dashboard: () => DashboardPage.preload(),
  profile: () => ProfilePage.preload(),
};

// eslint-disable-next-line react-refresh/only-export-components -- route preload helper
export function preloadMainRoutes() {
  void routePreloads.landing();
  void routePreloads.auth();
  void routePreloads.dashboard();
}

const DASHBOARD_TITLES: Record<string, string> = {
  overview: 'Overview',
  devices: 'Devices',
  queries: 'Queries',
  locations: 'Locations',
  games: 'Games',
  radio: 'Radio',
  assistant: 'Iris Assistant',
  profile: 'Profile',
  settings: 'Settings',
  notifications: 'Notifications',
  credits: 'Credits',
  users: 'Users',
  team: 'Team',
  integrations: 'Integrations',
  appeal: 'Appeal',
  appeals: 'Appeals',
};

function DocumentTitle() {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;
    const legacyTab = new URLSearchParams(location.search).get('tab');
    let title = 'Ayphr — Sensor data, without the plumbing';

    if (path.startsWith('/auth/login')) title = 'Log in — Ayphr';
    else if (path.startsWith('/auth/register')) title = 'Sign up — Ayphr';
    else if (path.startsWith('/policies/terms')) title = 'Terms of Service — Ayphr';
    else if (path.startsWith('/policies/privacy')) title = 'Privacy Policy — Ayphr';
    else if (path.startsWith('/policies/refund')) title = 'Refund Policy — Ayphr';
    else if (path.startsWith('/policies')) title = 'Policies — Ayphr';
    else if (path.startsWith('/link')) title = 'Connect a device — Ayphr';
    else if (path.startsWith('/dashboard')) {
      const route = parseDashboardPath(path, legacyTab);
      const label = route.profileEdit
        ? 'Edit Profile'
        : route.staffUser
          ? 'User details'
          : DASHBOARD_TITLES[route.tab] ?? 'Dashboard';
      title = route.device?.serial
        ? `Device ${route.device.serial} — Ayphr`
        : `${label} — Ayphr`;
    } else if (path !== '/') title = 'Page not found — Ayphr';

    document.title = title;
  }, [location]);

  return null;
}

function FocusModeWatcher() {
  useEffect(() => {
    const root = document.documentElement;
    const enable = (event: KeyboardEvent) => {
      // Keep the visual ring for keyboard navigation only. Text fields match
      // :focus-visible on pointer clicks too, so track the input modality.
      const target = event.target;
      const isTextField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if (isTextField && event.key !== 'Tab') return;

      if (
        event.key === 'Tab' ||
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.key.startsWith('Arrow') ||
        event.key === 'Home' ||
        event.key === 'End' ||
        event.key === 'PageUp' ||
        event.key === 'PageDown'
      ) {
        root.classList.add('keyboard-focus');
      }
    };
    const disable = () => root.classList.remove('keyboard-focus');

    document.addEventListener('keydown', enable, true);
    document.addEventListener('pointerdown', disable, true);
    document.addEventListener('mousedown', disable, true);
    return () => {
      document.removeEventListener('keydown', enable, true);
      document.removeEventListener('pointerdown', disable, true);
      document.removeEventListener('mousedown', disable, true);
    };
  }, []);

  return null;
}

function TooltipRouteWatcher() {
  const location = useLocation();
  const { hideTooltip } = useTooltip();
  useEffect(() => {
    hideTooltip();
  }, [location, hideTooltip]);
  return null;
}

function RouteFallback() {
  const location = useLocation();

  if (location.pathname.startsWith('/dashboard')) {
    const route = parseDashboardPath(
      location.pathname,
      new URLSearchParams(location.search).get('tab'),
    );
    return <DashboardLoadingSkeleton activeTab={route.tab} />;
  }

  if (location.pathname === '/') {
    return null;
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <p>Loading...</p>
    </div>
  );
}

function App() {
  useEffect(() => {
    const id = globalThis.requestIdleCallback?.(() => preloadMainRoutes());
    const timeout = globalThis.setTimeout(() => preloadMainRoutes(), 1500);
    return () => {
      if (id !== undefined) globalThis.cancelIdleCallback?.(id);
      globalThis.clearTimeout(timeout);
    };
  }, []);

  const dashboardElement = (
    <PolicyGate loadingFallback={<DashboardLoadingSkeleton />}>
      <EmailGate loadingFallback={<DashboardLoadingSkeleton />}>
        <DashboardPage />
      </EmailGate>
    </PolicyGate>
  );

  return (
    <TooltipProvider>
      <ModalProvider>
        <RadioProvider>
          <BrowserRouter>
            <TooltipRouteWatcher />
            <FocusModeWatcher />
            <DocumentTitle />
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/auth" element={<Navigate to="/auth/login" replace />} />
                <Route path="/auth/login" element={<AuthPage initialMode="login" />} />
                <Route path="/auth/register" element={<AuthPage initialMode="signup" />} />
                <Route path="/link" element={<LinkPage />} />
                <Route path="/policies" element={<PoliciesPage />} />
                <Route path="/policies/terms" element={<TermsPage />} />
                <Route path="/policies/privacy" element={<PrivacyPage />} />
                <Route path="/policies/refunds" element={<RefundPage />} />
                <Route path="/policies/refund" element={<Navigate to="/policies/refunds" replace />} />
                <Route path="/dashboard" element={dashboardElement} />
                <Route path="/dashboard/profile/edit" element={dashboardElement} />
                <Route path="/dashboard/profile/:userUuid/edit" element={<PolicyGate><EmailGate><ProfilePage initialEditing /></EmailGate></PolicyGate>} />
                <Route path="/dashboard/profile/:userUuid" element={<PolicyGate><EmailGate><ProfilePage /></EmailGate></PolicyGate>} />
                <Route path="/dashboard/*" element={dashboardElement} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </RadioProvider>
      </ModalProvider>
    </TooltipProvider>
  );
}

export default App;
