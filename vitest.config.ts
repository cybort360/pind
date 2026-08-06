import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // DB-backed suites share a single test database; parallel files would
      // truncate each other's rows mid-assertion.
      fileParallelism: false,
    },
  }),
);
