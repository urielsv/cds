/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public Blob URL of `collection/index.json`. Unset → demo fixture. */
  readonly VITE_COLLECTION_INDEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
