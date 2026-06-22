import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// NOTE on deployment base path:
//   For GitHub Pages project sites the app is served from /<repo>/, so build with
//   `vite build --base=/<repo>/`  (or set base below). Netlify/Vercel/root hosts: leave '/'.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  worker: {
    // Workers (peaks + BPM/essentia) are authored as ES modules.
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // essentia.js ships a large prebuilt WASM bundle; let Vite handle it as-is rather
  // than trying to pre-bundle it for the optimizer.
  optimizeDeps: {
    exclude: ['essentia.js'],
  },
});
