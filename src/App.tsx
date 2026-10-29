import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import {
  AuthPage,
  DashboardPage,
  ProfilePage,
  PoliciesPage,
  TermsPage,
  PrivacyPage,
  RefundPage,
  LandingPage,
  LinkPage,
} from './pages';
import { PolicyGate } from './components/policy';
import { AuthorizePage } from './pages/oauth';
import { ModalProvider, TooltipProvider, useTooltip } from './context';

function TooltipRouteWatcher() {
  const location = useLocation();
  const { hideTooltip } = useTooltip();
  useEffect(() => {
    hideTooltip();
  }, [location, hideTooltip]);
  return null;
}

function App() {
  return (
    <TooltipProvider>
      <ModalProvider>
        <BrowserRouter>
          <TooltipRouteWatcher />
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
            <Route path="/dashboard" element={<PolicyGate><DashboardPage /></PolicyGate>} />
            <Route path="/dashboard/profile/:userUuid" element={<PolicyGate><ProfilePage /></PolicyGate>} />
            <Route path="/oauth/authorize" element={<AuthorizePage />} />
          </Routes>
        </BrowserRouter>
      </ModalProvider>
    </TooltipProvider>
  );
}

export default App;
