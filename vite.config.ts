import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A blank PORT counts as 3000, the same as the server.
const port = process.env.PORT?.trim() || '3000';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  server: { proxy: { '/api': `http://127.0.0.1:${port}` } },
});
