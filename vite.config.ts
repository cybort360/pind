import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

// PORT is the single public-facing port. Replit injects it; 5000 is the local
// default. In development Vite owns that port and proxies API traffic to the
// Express server running privately on API_PORT. In production Express owns
// PORT directly and serves the built client itself.
const publicPort = Number(process.env.PORT ?? 5000);
const apiPort = Number(process.env.API_PORT ?? 3001);
// 127.0.0.1 rather than "localhost": Express binds IPv4 only, and on hosts that
// resolve localhost to ::1 first the proxy would otherwise get ECONNREFUSED.
const apiTarget = `http://127.0.0.1:${apiPort}`;

// Replit terminates TLS at its edge proxy, so the HMR websocket has to be told
// to dial wss://<domain>:443 instead of the local plaintext dev port.
const replitDomain = process.env.REPLIT_DEV_DOMAIN;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@shared': path.resolve(rootDir, 'shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: publicPort,
    // Fail loudly instead of drifting to a port Replit does not expose.
    strictPort: true,
    // Requests arrive with Replit's *.replit.dev Host header, which Vite's host
    // check rejects by default.
    allowedHosts: true,
    hmr: replitDomain ? { protocol: 'wss', host: replitDomain, clientPort: 443 } : undefined,
    proxy: {
      '/api': apiTarget,
      '/uploads': apiTarget,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: publicPort,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
  },
});
