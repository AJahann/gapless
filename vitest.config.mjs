import { defineConfig } from 'vitest/config';

// One project per workspace package. Add `apps/web` (jsdom) in Phase 4.
const nodeProject = (name, root) => ({
  test: {
    name,
    root,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

export default defineConfig({
  test: {
    passWithNoTests: true,
    reporters: process.env.GITHUB_ACTIONS
      ? ['default', 'github-actions']
      : ['default'],
    projects: [
      nodeProject('protocol', './packages/protocol'),
      nodeProject('engine', './packages/engine'),
      nodeProject('server', './apps/server'),
    ],
  },
});
