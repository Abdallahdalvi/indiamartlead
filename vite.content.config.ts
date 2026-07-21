import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Separate Vite config for the content script ONLY.
 *
 * Why separate?
 * Chrome MV3 does NOT support `"type": "module"` for content_scripts,
 * so the content script must be built as a self-contained IIFE bundle
 * (all dependencies inlined, no import statements in output).
 *
 * This config intentionally sets emptyOutDir: false so it adds
 * content.js to the dist/ folder already produced by the main build.
 *
 * Run order: `vite build` first, then `vite build --config vite.content.config.ts`
 * (Both are orchestrated by `npm run build`.)
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },

  build: {
    outDir: 'dist',
    emptyOutDir: false, // Preserve files already written by the main build
    sourcemap: false,
    minify: 'esbuild',
    target: 'chrome114',

    lib: {
      entry:   resolve(__dirname, 'src/content/index.ts'),
      name:    'LeadSyncContent',
      formats: ['iife'],
      // Always output as content.js regardless of entry filename
      fileName: () => 'content.js',
    },

    rollupOptions: {
      output: {
        // Force all dynamic imports to be inlined —
        // content scripts can't load sibling chunks.
        inlineDynamicImports: true,
      },
    },
  },
});
