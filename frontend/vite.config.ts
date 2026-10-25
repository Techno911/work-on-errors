import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';

// Единый источник версии платформы — frontend/package.json. UI читает __APP_VERSION__,
// хардкодить версию в компонентах запрещено (гейт scripts/version-sync.mjs). Так вёрстка
// физически не может разойтись с package.json, а бампится версия в одном месте.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      // Статика бэкенда (скриншоты, аудио звонков) — чтобы плеер работал в dev
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'ui-vendor': ['lucide-react', 'sonner'],
          'state-vendor': ['zustand', 'axios'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
