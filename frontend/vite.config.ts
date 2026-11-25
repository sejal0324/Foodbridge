/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/**
 * Development and preview servers proxy /api and /socket.io to the backend, so
 * the browser talks to a single origin and the httpOnly refresh cookie stays
 * first-party (SameSite=Strict, path /api/auth).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.FOODBRIDGE_API_PROXY_TARGET || 'http://127.0.0.1:5001';
  const proxy = {
    '/api': { target, changeOrigin: false },
    '/socket.io': { target, ws: true, changeOrigin: false },
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
    build: {
      // Maps are generated for error reporting but not referenced from the served bundles.
      sourcemap: 'hidden',
      chunkSizeWarningLimit: 700,
    },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./tests/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  };
});
