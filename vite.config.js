import { defineConfig } from 'vite';

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
  plugins: [style_only_hmr()],
  build: {
    target: ['chrome120'],
    outDir: '../dist',
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