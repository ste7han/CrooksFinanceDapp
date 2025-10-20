import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rpc': {
        target: 'https://evm.cronos.org',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/rpc/, ''),
      },
      '/ebisus': {
        target: 'https://api.ebisusbay.com',
        changeOrigin: true,
        ws: true,
        secure: true,
        // 👇 important: preserve the socket.io part
        rewrite: (p) => p.replace(/^\/ebisus/, ''),
      },
      // ✅ NEW: Cronos Explorer API proxy (bypass CORS)
      '/cronosapi': {
        target: 'https://explorer-api.cronos.org',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/cronosapi/, ''),
      },
    },
  },
})
