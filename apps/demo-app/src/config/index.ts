/**
 * Resolves the Syncra API base URL.
 *
 * Read from the `VITE_SYNCRA_API_URL` environment variable (set at build time
 * via `.env`, `.env.production`, or an inline build var). Falls back to the
 * local dev URL when unset.
 */
const DEFAULT_API_URL = 'http://localhost:3000/api';

export function getApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_SYNCRA_API_URL as string | undefined;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return DEFAULT_API_URL;
}
