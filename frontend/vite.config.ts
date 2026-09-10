import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function versionManifest(appVersion: string): Plugin {
  return {
    name: 'overtone-version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({
          version: appVersion,
        })}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), versionManifest(env.APP_VERSION || 'dev')],
    server: {
      host: '0.0.0.0',
      port: Number(env.FRONTEND_DEV_PORT || 5173),
      proxy: {
        '/api': env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3000',
      },
    },
  };
});
