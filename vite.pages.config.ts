import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/zve10-watermark-app/',
  plugins: [react()],
  build: {
    outDir: 'pages-dist',
    emptyOutDir: true,
  },
});

