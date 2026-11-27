import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The local real-data file (`data/local/real-db.json`, git-ignored), handed to
 * the game by the dev server alone. A build never contains it: the itch.io and
 * desktop games only ever have the generated world.
 */
function localRealDb(): Plugin {
  const file = resolve(__dirname, 'data/local/real-db.json');
  return {
    name: 'local-real-db',
    apply: 'serve',
    configureServer(server) {
      for (const [url, path] of [['/__local/real-db.json', file], ['/__local/real-db-women.json', resolve(__dirname, 'data/local/real-db-women.json')]] as const) {
      server.middlewares.use(url, (_req, res) => {
        if (!existsSync(path)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(path));
      });
      }
      // The real clubs' and leagues' logos and the players' photos, from the same local folder.
      const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
      for (const folder of ['real-logos', 'real-photos']) {
        const dir = resolve(__dirname, 'data/local', folder);
        server.middlewares.use(`/__local/${folder}/`, (req, res) => {
          const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').split('?')[0]);
          const path = resolve(dir, name);
          const ext = name.split('.').pop() ?? '';
          if (!/^[a-z0-9-]+\.[a-z]+$/.test(name) || !path.startsWith(dir) || !existsSync(path) || types[ext] === undefined) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('Content-Type', types[ext]);
          res.end(readFileSync(path));
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localRealDb()],
  // Relative paths, so the build runs from any folder — itch.io serves a game from a subfolder of its own.
  base: './',
  // The real-data import writes thousands of files under data/: nothing there is source, so it is not watched.
  server: { port: 5180, watch: { ignored: ['**/data/**'] } },
  build: { target: 'es2022', outDir: 'dist' },
});
