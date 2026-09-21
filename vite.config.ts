import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    // Source maps let us read real stack traces from a phone without shipping
    // them to every visitor.
    sourcemap: 'hidden',
    target: 'es2023',
    rollupOptions: {
      output: {
        // Keep the animation runtime in its own chunk: it is large, cacheable,
        // and shared by every route. Vite 8 / Rolldown requires the function
        // form of manualChunks; the object map is no longer accepted.
        manualChunks(id) {
          if (id.includes('node_modules/motion')) return 'motion';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}', 'shared/**/*.ts'],
      exclude: ['src/test/**', '**/*.d.ts', 'src/main.tsx'],
    },
  },
});
