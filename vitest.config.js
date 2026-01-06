import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
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
        'src/editor/index.js',
        '**/*.stories.jsx'
      ]
    }
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared')
    }
  },
  esbuild: {
    // Handle JSX in .js files (common in this codebase)
    loader: 'jsx',
    include: /\.(js|jsx)$/,
    exclude: [],
    // Auto-inject React for JSX
    jsx: 'automatic'
  }
});
