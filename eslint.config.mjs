import neostandard from 'neostandard';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  // Global ignores
  {
    ignores: ['src/lib', 'public', 'dist', '.storybook']
  },

  // neostandard base config, no style rules, browser globals
  ...neostandard({ noStyle: true, env: ['browser'] }),

  // React recommended rules
  reactPlugin.configs.flat.recommended,
  reactPlugin.configs.flat['jsx-runtime'],

  // React hooks recommended rules
  reactHooks.configs.flat.recommended,

  // Project config
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        STREET: 'readonly',
        AFRAME: 'readonly',
        THREE: 'readonly'
      }
    },
    plugins: {
      react: reactPlugin
    },
    settings: {
      react: { version: 'detect' }
    },
    rules: {
      'no-useless-return': 'off',
      'no-var': 'off',
      'object-shorthand': 'off',
      'prefer-const': 'off',
      'react/jsx-boolean-value': 'off',
      'react/jsx-handler-names': 'off',
      'react/prop-types': 'off',
      'react/self-closing-comp': 'off',
      'react-hooks/set-state-in-effect': 'off'
    }
  }
];
