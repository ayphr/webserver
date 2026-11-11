import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { PolicyGate } from './components/policy';
import { EmailGate } from './components/auth/EmailGate';
import { ModalProvider, TooltipProvider, useTooltip } from './context';
import { DashboardLoadingSkeleton } from './pages/dashboard/DashboardLoadingSkeleton';

const AuthPage = lazy(() => import('./pages/auth/AuthPage').then((m) => ({ default: m.AuthPage })));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ProfilePage = lazy(() => import('./pages/dashboard/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const PoliciesPage = lazy(() => import('./pages/policies/PoliciesPage').then((m) => ({ default: m.PoliciesPage })));
const TermsPage = lazy(() => import('./pages/policies/TermsPage').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import('./pages/policies/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const RefundPage = lazy(() => import('./pages/policies/RefundPage').then((m) => ({ default: m.RefundPage })));
const LandingPage = lazy(() => import('./pages/landing/LandingPage').then((m) => ({ default: m.LandingPage })));
const LinkPage = lazy(() => import('./pages/link/LinkPage').then((m) => ({ default: m.LinkPage })));
const AuthorizePage = lazy(() => import('./pages/oauth/AuthorizePage').then((m) => ({ default: m.AuthorizePage })));

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
    return <DashboardLoadingSkeleton activeTab={new URLSearchParams(location.search).get('tab') ?? undefined} />;
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
  return (
    <TooltipProvider>
      <ModalProvider>
        <BrowserRouter>
          <TooltipRouteWatcher />
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
              <Route path="/dashboard" element={<PolicyGate loadingFallback={<DashboardLoadingSkeleton />}><EmailGate loadingFallback={<DashboardLoadingSkeleton />}><DashboardPage /></EmailGate></PolicyGate>} />
              <Route path="/dashboard/profile/:userUuid" element={<PolicyGate><EmailGate><ProfilePage /></EmailGate></PolicyGate>} />
              <Route path="/oauth/authorize" element={<AuthorizePage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ModalProvider>
    </TooltipProvider>
  );
}

export default App;
