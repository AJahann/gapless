import { defineConfig } from 'tsup';

// Workspace packages export TypeScript source, so bundle them into the output.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@gapless\//],
});
