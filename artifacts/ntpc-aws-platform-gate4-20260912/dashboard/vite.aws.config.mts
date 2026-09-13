import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig(({mode}) => {
  const internal=mode==='internal';
  return {
    base: internal?'/internal/':'/',
    plugins:[react(), {name:'aws-isolated-policy',enforce:'pre',resolveId(source) {
      if(source==='./policy-workflow') return path.resolve(internal?'app/aws-roa.tsx':'app/aws-public-stub.tsx');
      if(!internal&&source==='./export-center') return path.resolve('app/aws-public-stub.tsx');
      if(source==='next/server') return path.resolve('app/aws-next-response.ts');
    }}],
    define: {'import.meta.env.NTPC_INTERNAL':JSON.stringify(internal)},
    build:{outDir:internal?'dist-internal':'dist-public',sourcemap:false,chunkSizeWarningLimit:1800},
  };
});
