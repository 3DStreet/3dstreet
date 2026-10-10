const path = require('path');
const { pluginReact } = require('@rsbuild/plugin-react');
const { pluginSass } = require('@rsbuild/plugin-sass');

/** @type { import('storybook-react-rsbuild').StorybookConfig } */
const config = {
  stories: [
    '../src/shared/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    '../src/generator/**/*.stories.@(js|jsx|mjs|ts|tsx)'
  ],
  addons: ['@storybook/addon-docs', '@storybook/addon-onboarding'],
  framework: {
    name: 'storybook-react-rsbuild',
    options: {}
  },
  staticDirs: [{ from: '../ui_assets', to: '/ui_assets' }],
  rsbuildFinal: async (config) => {
    const { mergeRsbuildConfig } = await import('@rsbuild/core');
    return mergeRsbuildConfig(config, {
      plugins: [pluginReact(), pluginSass()],
      source: {
        // Source .js files contain JSX too, not only .jsx.
        include: [/\.jsx?$/],
        // Mock Firebase config for Storybook
        define: {
          'process.env.FIREBASE_API_KEY': JSON.stringify('mock-api-key'),
          'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(
            'mock-project.firebaseapp.com'
          ),
          'process.env.FIREBASE_PROJECT_ID': JSON.stringify('mock-project'),
          'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(
            'mock-project.appspot.com'
          ),
          'process.env.FIREBASE_MESSAGING_SENDER_ID':
            JSON.stringify('123456789'),
          'process.env.FIREBASE_APP_ID': JSON.stringify(
            '1:123456789:web:abc123'
          ),
          'process.env.FIREBASE_MEASUREMENT_ID': JSON.stringify('G-ABCDEFG')
        }
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '../src'),
          '@shared': path.resolve(__dirname, '../src/shared')
        }
      },
      output: {
        // Match rspack.config.js: `import styles from './x.module.scss'` gets
        // a default export with class names kept as-is (already camelCase).
        cssModules: {
          namedExport: false,
          exportLocalsConvention: 'asIs'
        }
      }
    });
  }
};

module.exports = config;
