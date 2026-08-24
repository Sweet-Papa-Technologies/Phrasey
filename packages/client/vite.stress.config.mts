import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const CLIENT = '/Users/fterry/code/Phrasey/packages/client';
const STRESS =
  '/private/tmp/claude-501/-Users-fterry-code-Phrasey/2b0695b3-15d8-4319-ab5d-e8822934ab6a/scratchpad/stressPuzzles.ts';

// Verification-only build: swaps the mock corpus for deliberately long phrases
// so the board layout can be seen under its worst case.
export default defineConfig({
  root: CLIENT,
  plugins: [
    {
      name: 'stress-corpus',
      enforce: 'pre',
      resolveId(source: string) {
        if (source.endsWith('mockPuzzles') || source.endsWith('mockPuzzles.ts')) return STRESS;
        return null;
      },
    },
    react(),
    tailwindcss(),
  ],
  build: { target: 'es2022', assetsInlineLimit: 2048 },
});
