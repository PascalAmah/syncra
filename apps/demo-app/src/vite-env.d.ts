/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Syncra API base URL, e.g. https://your-api.com/api */
  readonly VITE_SYNCRA_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
