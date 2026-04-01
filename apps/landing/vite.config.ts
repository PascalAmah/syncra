import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'html-rewrite',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const map: Record<string, string> = {
            '/':           '/landing.html',
            '/login':      '/pages/login.html',
            '/signup':     '/pages/signup.html',
            '/dashboard':  '/pages/dashboard.html',
            '/project':    '/pages/project.html',
            '/docs':       '/pages/docs.html',
            '/onboarding': '/pages/onboarding.html',
            '/playground': '/pages/playground.html',
            '/api-keys':   '/pages/api-keys.html',
            '/settings':   '/pages/settings.html',
          };
          const path = req.url?.split('?')[0] ?? '';
          if (map[path]) req.url = map[path];
          next();
        });
      },
    },
  ],
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
