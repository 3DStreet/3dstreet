/**
 * Localizes the static Bollard Buddy AR page (public/bollardbuddy/index.html).
 *
 * That page is plain HTML with inline scripts, not a React tree, so its
 * user-facing copy is localized here from the same framework-free
 * `sharedMessages` table used by the React islands. The active locale comes
 * from the shared `getActiveLocale()` (localStorage `locale` → browser
 * language → English), so it matches whatever the user last chose in the
 * editor. There is no language switcher on this page, so the locale is fixed
 * for the page load and a one-shot DOM pass is sufficient.
 *
 * Two DOM conventions:
 *   data-i18n="key"            → textContent set to the message
 *   data-i18n-aria-label="key" → aria-label attribute set to the message
 *
 * The object picker's toggle-off label ("Select Object") is set at click time
 * by an inline script, so we hand it the translated string via
 * `window.BOLLARD_I18N` for it to read lazily.
 */

import { formatSharedMessage } from '@shared/i18n/sharedMessages';

// Picker items carry a `data-label` the inline toggle reads to relabel the
// button; keep it in sync with the localized visible text keyed by model.
const PICKER_LABEL_KEYS = {
  bollard: 'bbObjectBollard',
  cone: 'bbObjectCone'
  // safehit is a brand name — left untranslated.
};

export function localizePage() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = formatSharedMessage(el.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute(
      'aria-label',
      formatSharedMessage(el.dataset.i18nAriaLabel)
    );
  });

  // Keep each picker item's `data-label` in sync with its localized text so the
  // inline selection handler relabels the toggle in the active language.
  document.querySelectorAll('.picker-item[data-model]').forEach((item) => {
    const key = PICKER_LABEL_KEYS[item.dataset.model];
    if (key) item.dataset.label = formatSharedMessage(key);
  });

  // Expose the dynamic strings the inline picker script needs at interaction
  // time (it reads these lazily, with English fallbacks).
  window.BOLLARD_I18N = {
    selectObject: formatSharedMessage('bbSelectObject')
  };
}

export default localizePage;
