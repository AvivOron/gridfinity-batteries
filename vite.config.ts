import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/gridfinity-batteries/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['occt-wasm'],
  },
  build: {
    target: 'esnext',
  },
})
