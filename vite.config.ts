import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Public base path for the built assets.
 *
 * `./` (relative) rather than `/` on purpose: the very same build then works at
 * any path depth, because each asset URL resolves against the document's own
 * directory. That matters here because the site is reachable at two different
 * paths at once:
 *
 *   - https://wheat.chat/                       (custom domain, root)
 *   - https://zpc1995.github.io/wheat-tools/    (GitHub Pages project site)
 *
 * With an absolute `/` base the second one 404s every asset and renders blank —
 * which is exactly what happened before this change. Overridable via
 * `VITE_BASE` for the rare case a host needs an absolute prefix.
 *
 * Routing is hash-based, so no server-side rewrite rules are needed either way.
 */
const base = process.env.VITE_BASE ?? './';

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
    rollupOptions: {
      output: {
        /**
         * Name each lazily-loaded tool chunk after its directory.
         *
         * Every tool's entry file is called `index.ts`, so Rollup's default
         * naming produced a pile of indistinguishable `index-<hash>.js` files.
         * Deriving the name from the module path makes the split visible —
         * `assets/aes-crypto-<hash>.js` — which matters both for debugging and
         * for confirming that a heavy dependency really did leave the entry
         * bundle.
         */
        chunkFileNames: (chunkInfo) => {
          const id = chunkInfo.facadeModuleId ?? '';
          const match = /src\/tools\/([^/]+)\//.exec(id.replace(/\\/g, '/'));
          if (match) return `assets/tool-${match[1]}-[hash].js`;
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
