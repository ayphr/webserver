import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage, DashboardPage, ProfilePage, PoliciesPage, TermsPage, PrivacyPage, RefundPage } from './pages';
import { PolicyGate } from './components/policy';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/policies/terms" element={<TermsPage />} />
        <Route path="/policies/privacy" element={<PrivacyPage />} />
        <Route path="/policies/refunds" element={<RefundPage />} />
        <Route path="/policies/refund" element={<Navigate to="/policies/refunds" replace />} />
        <Route path="/dashboard" element={<PolicyGate><DashboardPage /></PolicyGate>} />
        <Route path="/dashboard/profile/:userUuid" element={<PolicyGate><ProfilePage /></PolicyGate>} />
        <Route path="/" element={<Navigate to="/auth" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
