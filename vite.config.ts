import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Public base path for the built assets.
 *
 * The site is served from a custom apex domain (`https://wheat.chat/`), so the
 * correct base is the root. The deploy workflow still passes `VITE_BASE`
 * explicitly, which keeps the build correct if the site is ever served from a
 * GitHub Pages project sub-path (`https://<user>.github.io/<repo>/`) instead —
 * a root base would make every asset 404 there.
 *
 * Routing is hash-based, so no server-side rewrite rules are needed either way.
 */
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    // Bind every interface so the dev server is reachable from other devices
    // on the LAN (and over the tailnet), not just from localhost.
    host: '0.0.0.0',
    port: 5273,
    strictPort: true,
    // Tell the browser where to open the HMR socket. Without this, a remote
    // client would try to reach the dev server on its own hostname.
    hmr: { host: '192.168.8.139', port: 5273 },
    // Vite rejects requests whose Host header it does not recognise. The
    // known addresses for this machine are whitelisted explicitly rather than
    // disabling the check wholesale, because the port is now publicly bound.
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '192.168.8.139',
      '100.64.0.4',
      'wheat.chat',
      '.wheat.chat',
      '.local',
      '.ts.net',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
