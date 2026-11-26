import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { /** existing suites keep today's behaviour (autonomy C14); open-mode tests ask for it */ env: { PF_MODE: 'guarded' }, include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'tools/*/*.test.ts'] } });
