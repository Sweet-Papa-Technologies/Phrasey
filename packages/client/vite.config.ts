import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    // Fonts are self-hosted; keep them as real files so they can be preloaded
    // and long-cached rather than inlined into CSS.
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ['motion/react'],
          qrcode: ['qrcode'],
        },
      },
    },
  },
  // Vitest reads this block at runtime. Its type augmentation ships with a
  // newer Vite than this package pins, so importing `vitest/config` here would
  // collide on Plugin types — the runtime behaviour is identical.
  // @ts-expect-error -- `test` is a Vitest key, not a Vite one.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
