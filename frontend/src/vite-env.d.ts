/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Версия платформы из frontend/package.json (vite define). Единственный источник версии в UI.
// Тип уже, чем string: AppShell и LoginShell пакета принимают только номер X.Y.Z (канон
// оболочки, раздел 14), строку «Название, vX.Y.Z» собирает сам пакет.
declare const __APP_VERSION__: `${number}.${number}.${number}`;
