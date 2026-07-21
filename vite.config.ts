import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/**
 * Main Vite build config.
 * Handles three entry points:
 *   - popup.html      → dist/popup.html  (React popup UI)
 *   - sidepanel.html  → dist/sidepanel.html (React side-panel UI)
 *   - src/background  → dist/background.js  (MV3 service worker, ES module)
 *
 * The content script is built separately via vite.content.config.ts
 * because Chrome content scripts must be IIFE bundles (not ES modules).
 */
export default defineConfig({
  plugins: [react()],

  // Everything in public/ is copied as-is to dist/
  // (manifest.json, icons/)
  publicDir: 'public',

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    target: 'chrome114',

    rollupOptions: {
      input: {
        popup:      resolve(__dirname, 'popup.html'),
        sidepanel:  resolve(__dirname, 'sidepanel.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        format: 'es',

        // Give background.js a fixed, predictable name (referenced in manifest).
        // All other entry chunks (popup, sidepanel) go to assets/ with hashes.
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background.js';
          return 'assets/[name]-[hash].js';
        },

        chunkFileNames:  'chunks/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',
      },
    },
  },
});
