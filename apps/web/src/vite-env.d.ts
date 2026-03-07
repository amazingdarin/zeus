/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
  readonly BASE_URL: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_BACKEND_URL?: string;
  readonly VITE_SERVER_URL?: string;
  readonly VITE_REMOTE_KNOWLEDGE_BASE_URL?: string;
  readonly VITE_REMOTE_APP_BACKEND_URL?: string;
  readonly VITE_LOCAL_DEFAULT_PROJECT_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
