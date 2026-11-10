import { defineConfig } from '@fullstacksjs/oxlint-config';

export default defineConfig({
  modules: {
    nodejs: true,
    react: true,
    nextjs: true,
    vitest: true,
  },
  overrides: [
    {
      // Single typed env boundary per app; all other code receives config.
      files: ['apps/server/src/config/env.ts', 'apps/web/src/config/env.ts'],
      rules: {
        'node/no-process-env': 'off',
      },
    },
  ],
});
