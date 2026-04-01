import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'landing.html'),
        login: resolve(__dirname, 'pages/login.html'),
        signup: resolve(__dirname, 'pages/signup.html'),
        dashboard: resolve(__dirname, 'pages/dashboard.html'),
        project: resolve(__dirname, 'pages/project.html'),
        docs: resolve(__dirname, 'pages/docs.html'),
        onboarding: resolve(__dirname, 'pages/onboarding.html'),
        playground: resolve(__dirname, 'pages/playground.html'),
        'api-keys': resolve(__dirname, 'pages/api-keys.html'),
        settings: resolve(__dirname, 'pages/settings.html'),
      },
    },
  },
});
