import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative paths, so the build runs from any folder — itch.io serves a game from a subfolder of its own.
  base: './',
  server: { port: 5180 },
  build: { target: 'es2022', outDir: 'dist' },
});
