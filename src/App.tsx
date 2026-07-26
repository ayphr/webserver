import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage, DashboardPage, ProfilePage } from './pages';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/profile/:userUuid" element={<ProfilePage />} />
        <Route path="/" element={<Navigate to="/auth" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
