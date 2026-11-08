import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative paths: the Android app serves the game from its own files.
  base: './',
  // The Android project holds a built copy of the game: changes there are not the game's.
  server: { port: 5190, host: true, watch: { ignored: ['**/android/**', '**/dist/**', '**/release/**'] } },
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 4000 },
});
