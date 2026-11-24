import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    // Bind IPv4 explicitly: WebView2 and browsers may resolve localhost to
    // 127.0.0.1, and an IPv6-only bind refuses those connections.
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    // The public NATAPP preview serves this development UI over its own host.
    allowedHosts: ['.natappfree.cc'],
    // Keep the web preview same-origin. Tauri production requests are unaffected.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
    // Rust build outputs can be locked while the desktop app is running.
    // They are not frontend sources and must never enter Vite's watcher.
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
