import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const base=fileURLToPath(new URL('.',import.meta.url));
// Separate loopback-only review app. No auth bypass or new production route.
export default defineConfig({
  root:base+'prototypes/lsf',plugins:[react()],
  server:{host:'127.0.0.1',port:4176,strictPort:true,fs:{allow:[base]}},
  build:{outDir:base+'dist-lsf',emptyOutDir:true},
});
