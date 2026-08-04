import { useState } from 'react';
import { SdkProvider } from './context/SdkContext';
import { AuthForm } from './components/auth/AuthForm';
import { JobsPage } from './pages/JobsPage';

export default function App() {
  const [authState, setAuthState] = useState<{ email: string; token: string } | null>(() => {
    const token = localStorage.getItem('syncra_token');
    const email = localStorage.getItem('syncra_email') ?? '';
    return token ? { email, token } : null;
  });

  function handleAuth(email: string, token: string) {
    localStorage.setItem('syncra_token', token);
    localStorage.setItem('syncra_email', email);
    // Demo: use email as a stable user id for the API header
    localStorage.setItem('syncra_user_id', email);
    setAuthState({ email, token });
  }

  function handleLogout() {
    localStorage.removeItem('syncra_token');
    localStorage.removeItem('syncra_email');
    localStorage.removeItem('syncra_user_id');
    setAuthState(null);
  }

  if (!authState) {
    return <AuthForm onAuth={handleAuth} />;
  }

  return (
    <SdkProvider key={authState.token}>
      <JobsPage userEmail={authState.email} onLogout={handleLogout} />
    </SdkProvider>
  );
}
