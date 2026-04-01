import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { SyncraSDK } from 'syncra-sdk';

const SdkContext = createContext<SyncraSDK | null>(null);

export function useSdk(): SyncraSDK {
  const sdk = useContext(SdkContext);
  if (!sdk) throw new Error('useSdk must be used inside <SdkProvider>');
  return sdk;
}

export function SdkProvider({ children }: { children: React.ReactNode }) {
  const sdkRef = useRef<SyncraSDK | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const apiKey = localStorage.getItem('syncra_api_key') ?? undefined;
    const userId = localStorage.getItem('syncra_user_id') ?? undefined;
    const bearerToken = localStorage.getItem('syncra_token') ?? undefined;
    const sdk = new SyncraSDK({
      baseUrl: 'http://localhost:3000/api',
      apiKey,
      userId,
      bearerToken,
      syncInterval: 30_000,
    });

    sdkRef.current = sdk;
    sdk.initialize().then(() => {
      setReady(true);
      // Auto-sync on startup to pull latest records from server
      if (sdk.isOnlineState()) {
        sdk.sync().catch(() => {});
      }
    });

    return () => sdk.destroy();
  }, []);

  if (!ready || !sdkRef.current) {
    return <div style={{ padding: 24 }}>Initializing SDK…</div>;
  }

  return (
    <SdkContext.Provider value={sdkRef.current}>
      {children}
    </SdkContext.Provider>
  );
}

