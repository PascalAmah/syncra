import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@syncra/sdk': path.resolve(__dirname, '../../apps/sdk/src'),
      '@syncra/config': path.resolve(__dirname, '../../packages/config/src'),
    },
  },
});
