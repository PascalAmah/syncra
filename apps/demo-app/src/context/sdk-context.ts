import { createContext, useContext } from 'react';
import { SyncraSDK } from 'syncra-sdk';

export const SdkContext = createContext<SyncraSDK | null>(null);

export function useSdk(): SyncraSDK {
  const sdk = useContext(SdkContext);
  if (!sdk) throw new Error('useSdk must be used inside <SdkProvider>');
  return sdk;
}
