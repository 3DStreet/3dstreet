/**
 * Plugin loader: registers every `src/plugins/<id>/index.js` at startup.
 * Adding a plugin folder is all it takes; no core file lists plugins.
 * Docs: docs/plugins.md.
 */

const pluginModules = require.context('./', true, /^\.\/[^/]+\/index\.js$/);

pluginModules.keys().forEach((key) => {
  try {
    pluginModules(key);
  } catch (err) {
    // One broken plugin must not take the app down with it.
    console.error(`[plugins] failed to load ${key}`, err);
  }
});
