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
      // Keep ESLint's recommended set as hard errors (real bugs). quotes stays
      // a warning: the code (and main repo via prettier) is single-quoted, but
      // the legacy .eslintrc declared 'double' and was never actually enforced,
      // so this is cosmetic debt we don't want blocking deploys.
      quotes: ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }]
    }
  }
];
