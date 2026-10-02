import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API runs on 4000; proxying keeps every fetch same-origin so there is
    // no CORS surprise between the dev setup and a real deployment.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/webhooks': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
});
