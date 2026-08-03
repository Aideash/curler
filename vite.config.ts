import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolvePorts, resolveDomain } from './config.mjs'

export default defineConfig(({ mode }) => {
  // An empty prefix loads every key, not just the VITE_ ones. These never reach
  // the client bundle; they only configure the dev server itself.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  const ports = resolvePorts(env)
  const domain = resolveDomain(env)

  return {
    plugins: [vue()],
    server: {
      port: ports.ui,
      strictPort: true,
      // Vite rejects unrecognised hosts with a 403.
      allowedHosts: domain ? [domain] : undefined,
      proxy: {
        // The API server performs the actual HTTP calls, so nothing the app sends
        // is subject to the browser's CORS or cookie rules.
        '/api': {
          target: `http://127.0.0.1:${ports.api}`,
          changeOrigin: false,
        },
      },
    },
  }
})
