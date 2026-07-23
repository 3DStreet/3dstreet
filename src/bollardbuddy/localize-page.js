/**
 * Localizes the static Bollard Buddy AR page (public/bollardbuddy/index.html).
 *
 * That page is plain HTML with inline scripts, not a React tree, so its
 * user-facing copy is localized here from the same framework-free
 * `sharedMessages` table used by the React islands. The active locale comes
 * from the shared `getActiveLocale()` (localStorage `locale` → browser
 * language → English), so it matches whatever the user last chose in the
 * editor.
 *
 * The profile menu (ProfileHoverCard → LanguageSelector) IS mounted on this
 * page, so the language can change at runtime. Unlike the generator we do NOT
 * reload — a reload would tear down the live WebXR/8th Wall AR session — so
 * instead we re-run the DOM pass on every locale change. The pass is idempotent
 * (it reads the same `data-i18n*` hooks each time), and the React islands
 * re-render live via useSharedLocale.
 *
 * Two DOM conventions:
 *   data-i18n="key"            → textContent set to the message
 *   data-i18n-aria-label="key" → aria-label attribute set to the message
 *
 * The object picker's toggle-off label ("Select Object") is set at click time
 * by an inline script, so we hand it the translated string via
 * `window.BOLLARD_I18N` for it to read lazily. The toggle's CURRENT label
 * reflects the selected model, so after each pass we re-derive it from the
 * live selection instead of leaving the data-i18n default in place.
 */

import {
  formatSharedMessage,
  LOCALE_CHANGED_EVENT
} from '@shared/i18n/sharedMessages';
import { getActiveLocale } from '@shared/utils/format';

// Picker items carry a `data-label` the inline toggle reads to relabel the
// button; keep it in sync with the localized visible text keyed by model.
const PICKER_LABEL_KEYS = {
  bollard: 'bbObjectBollard',
  cone: 'bbObjectCone'
  // safehit is a brand name — left untranslated.
};

function applyTranslations() {
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

  // The toggle label above was reset to its data-i18n default (Bollard) by the
  // pass; restore it to reflect the live selection so a re-localize mid-session
  // doesn't silently flip the visible object back to Bollard.
  const pickerLabel = document.getElementById('picker-label');
  if (pickerLabel) {
    const selected = document.querySelector(
      '.picker-item.selected[data-model]'
    );
    if (window.selectedModel && selected) {
      pickerLabel.textContent = selected.dataset.label;
    } else if (!window.selectedModel) {
      pickerLabel.textContent = window.BOLLARD_I18N.selectObject;
    }
  }
}

export function localizePage() {
  applyTranslations();

  // Re-localize when the language changes at runtime (same-tab via the shared
  // locale-changed broadcast, cross-tab via the storage event). Guarded so a
  // storage write to some other key is a no-op. Installed once.
  if (!window.__bbLocaleListenerInstalled) {
    window.__bbLocaleListenerInstalled = true;
    let rendered = getActiveLocale();
    const relocalizeIfChanged = () => {
      if (getActiveLocale() !== rendered) {
        rendered = getActiveLocale();
        applyTranslations();
      }
    };
    window.addEventListener(LOCALE_CHANGED_EVENT, relocalizeIfChanged);
    window.addEventListener('storage', relocalizeIfChanged);
  }
}

export default localizePage;
