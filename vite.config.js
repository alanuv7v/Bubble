import { defineConfig } from 'vite';
import { cpSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

function style_only_hmr() {
  return {
    name: 'style-only-hmr',
    handleHotUpdate({ file, modules }) {
      const is_style_file = /\.(css|styl|stylus|scss|sass|less)$/.test(file);
      if (is_style_file) {
        return modules;
      }
      return [];
    }
  };
}

export default defineConfig({
  publicDir: 'public',
  plugins: [style_only_hmr(), {
    name: 'static-assets',
    apply: 'build',
    closeBundle() {
      // These paths are set in UI code, so Vite cannot discover them as imports.
      cpSync('icons', 'dist/icons', { recursive: true });
      copyFileSync('assets/profile_fallback.webp', 'dist/assets/profile_fallback.webp');
    },
  }],
  build: {
    target: ['chrome120'],
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
