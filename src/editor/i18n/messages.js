import en from './locales/en.json';
import es from './locales/es.json';
import ptBR from './locales/pt-BR.json';
import fr from './locales/fr.json';

/**
 * Flat id → string message catalogs, keyed by locale code. Catalogs are
 * generated: `en.json` is produced by `npm run i18n:extract` (formatjs scans
 * the source for FormattedMessage/defineMessages defaultMessages), and the
 * translated catalogs by `npm run i18n:translate`.
 *
 * Catalogs are small (UI strings only) so static import is fine; revisit with
 * dynamic import + code-splitting if they grow large.
 */

/**
 * `en.json` is the extraction source of truth and stays in formatjs shape
 * ({ id: { defaultMessage, description } }) so `translate.mjs` can read the
 * source strings + descriptions. IntlProvider, however, wants flat
 * { id: string } — handing it the nested descriptors makes react-intl throw a
 * FORMAT_ERROR for every English key. Flatten to defaultMessage here (the
 * translated catalogs are already flat). Mirrors flattenEn() in translate.mjs.
 */
function flattenEn(catalog) {
  const out = {};
  for (const [id, descriptor] of Object.entries(catalog)) {
    out[id] =
      typeof descriptor === 'string' ? descriptor : descriptor.defaultMessage;
  }
  return out;
}

export const MESSAGES = {
  en: flattenEn(en),
  es,
  'pt-BR': ptBR,
  fr
};
