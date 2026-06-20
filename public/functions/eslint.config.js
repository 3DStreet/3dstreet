// Flat config (ESLint 9+/10). Replaces the legacy .eslintrc.js, which ESLint 10
// no longer reads. The old config extended `eslint-config-google`, but that
// package is unmaintained and references core rules (valid-jsdoc/require-jsdoc)
// that ESLint removed, so it can't load on v10 at all. We keep ESLint's
// recommended set plus the one house rule we actually enforced (double quotes).
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      // Single quotes to match the code (and the app's prettier). avoidEscape
      // keeps strings that contain an apostrophe as double-quoted.
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }]
    }
  }
];
