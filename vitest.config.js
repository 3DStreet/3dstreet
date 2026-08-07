import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['test/{editor,generator,shared}/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/editor/**/*.{js,jsx}',
        'src/generator/**/*.js',
        'src/shared/**/*.{js,jsx}'
      ],
      exclude: [
        'src/generator/index.js',
        'src/editor/index.jsx',
        '**/*.stories.jsx'
      ]
    }
  },
  resolve: {
    alias: {
      // Both aliases webpack defines, so a module written against the app's
      // import paths can be unit-tested at all. `@` was absent until an editor
      // module importing `@/store` needed a test: without it the import fails to
      // resolve and the whole suite FILE is dropped, which prints as a collection
      // error rather than as a failing assertion.
      //
      // Exact-prefix matching means these cannot collide: an alias key matches
      // only on equality or on `key + '/'`, so neither `@shared/…` nor
      // `@testing-library/…` is touched, whatever the order.
      '@shared': path.resolve(__dirname, './src/shared'),
      '@': path.resolve(__dirname, './src')
    }
  }
});
