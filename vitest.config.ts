import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['tests/**/*.spec.ts', 'node_modules', 'dist'],
    testTimeout: 25000,
    maxWorkers: 2,
    env: {
      JWT_SECRET:
        process.env.JWT_SECRET ||
        'fortix_local_dev_secret_key_32_characters_minimum_entropy',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
