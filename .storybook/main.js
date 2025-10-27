const path = require('path');
const webpack = require('webpack');

/** @type { import('@storybook/react-webpack5').StorybookConfig } */
const config = {
  stories: ['../src/shared/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@storybook/addon-webpack5-compiler-swc',
    '@storybook/addon-docs',
    '@storybook/addon-onboarding'
  ],
  framework: {
    name: '@storybook/react-webpack5',
    options: {}
  },
  webpackFinal: async (config) => {
    // Add SCSS support
    config.module.rules.push({
      test: /\.module\.scss$/,
      use: [
        'style-loader',
        {
          loader: 'css-loader',
          options: {
            modules: true,
            sourceMap: true
          }
        },
        {
          loader: 'sass-loader',
          options: {
            sourceMap: true
          }
        }
      ]
    });

    config.module.rules.push({
      test: /\.scss$/,
      exclude: /\.module\.scss$/,
      use: [
        'style-loader',
        'css-loader',
        {
          loader: 'sass-loader',
          options: {
            sourceMap: true
          }
        }
      ]
    });

    // Add path aliases
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, '../src'),
      '@shared': path.resolve(__dirname, '../src/shared')
    };

    // Define process.env with mock Firebase config for Storybook
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.FIREBASE_API_KEY': JSON.stringify('mock-api-key'),
        'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(
          'mock-project.firebaseapp.com'
        ),
        'process.env.FIREBASE_PROJECT_ID': JSON.stringify('mock-project'),
        'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(
          'mock-project.appspot.com'
        ),
        'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify('123456789'),
        'process.env.FIREBASE_APP_ID': JSON.stringify('1:123456789:web:abc123'),
        'process.env.FIREBASE_MEASUREMENT_ID': JSON.stringify('G-ABCDEFG'),
        'process.env.NODE_ENV': JSON.stringify('development')
      })
    );

    return config;
  }
};

export default config;
