import { defineConfig } from 'vite'
import { geaPlugin } from '@geajs/vite-plugin'

export default defineConfig({
  plugins: [geaPlugin()],
  // GitHub Pages serves a project site from /<repo>/, local dev from /.
  base: process.env.BASE_PATH || '/',
  server: { port: 5173 },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    modulePreload: { polyfill: false }
  }
})
