import { useState } from 'react';
import { SdkProvider } from './sdk-context';
import { AuthForm } from './AuthForm';
import { AppShell } from './AppShell';

export default function App() {
  const [authState, setAuthState] = useState<{ email: string; token: string } | null>(() => {
    const token = localStorage.getItem('syncra_token');
    const email = localStorage.getItem('syncra_email') ?? '';
    return token ? { email, token } : null;
  });

  function handleAuth(email: string, token: string) {
    localStorage.setItem('syncra_token', token);
    localStorage.setItem('syncra_email', email);
    setAuthState({ email, token });
  }

  function handleLogout() {
    localStorage.removeItem('syncra_token');
    localStorage.removeItem('syncra_email');
    setAuthState(null);
  }

  if (!authState) {
    return <AuthForm onAuth={handleAuth} />;
  }

  return (
    <SdkProvider key={authState.token}>
      <AppShell userEmail={authState.email} onLogout={handleLogout} />
    </SdkProvider>
  );
}
