import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  // Some editor modules keep JSX in `.js` files (entity.js renders toasts), which
  // the default transform only accepts in `.jsx`. `exclude` keeps a dependency's
  // own `src/` folder out of this rule if vitest ever inlines one.
  oxc: {
    lang: 'jsx',
    include: /src[\\/].*\.jsx?$/,
    exclude: /node_modules/,
    jsx: { runtime: 'automatic' }
  },
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
      // Mirror webpack's aliases so editor modules importing '@/…' are testable.
      '@shared': path.resolve(__dirname, './src/shared'),
      '@': path.resolve(__dirname, './src')
    }
  }
});
