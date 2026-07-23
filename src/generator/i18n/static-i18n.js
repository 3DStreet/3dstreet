/**
 * Applies the generator's message catalog to the static markup in
 * public/generator/index.html (header title, tab labels, loading text). Those
 * strings live in HTML rather than JS, so we translate them in place at startup
 * by walking `data-i18n*` hooks:
 *
 *   <span data-i18n="nav.tabImage">Image</span>            → textContent
 *   <img data-i18n-attr="alt:nav.appTitle" />              → attribute
 *
 * `data-i18n-attr` takes one or more `attr:messageId` pairs separated by `;`.
 * Also stamps <html lang> so the document advertises the rendered language.
 * A later language switch reloads the page (see index.js), so this only needs
 * to run once per load.
 */

import { t } from './messages.js';
import { getActiveLocale } from '@shared/utils/format';

export function applyStaticTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, id] = pair.split(':').map((s) => s.trim());
      if (attr && id) el.setAttribute(attr, t(id));
    });
  });

  try {
    document.documentElement.lang = getActiveLocale();
  } catch {
    // document unavailable (tests) — non-fatal
  }
}

export default applyStaticTranslations;
