import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';

const envDirectory = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig(({ mode }) => {
  const settings = loadEnv(mode, envDirectory, '');
  return {
    plugins: [react()],
    envDir: envDirectory,
    server: {
      host: '127.0.0.1',
      proxy: {
        '/v1': process.env.API_PROXY_TARGET ?? settings.API_PROXY_TARGET ?? 'http://127.0.0.1:3000',
      },
    },
    preview: { host: '127.0.0.1' },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      clearMocks: true,
    },
  };
});
