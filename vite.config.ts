import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
      '.local',
      '.ts.net',
    ],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
