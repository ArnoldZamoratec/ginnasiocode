import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // El navegador habla con un solo origen: la cookie de sesión (SameSite=Strict) funciona igual que en producción.
    proxy: { '/api': 'http://localhost:3001' },
  },
  build: { target: 'es2022', sourcemap: false },
});
