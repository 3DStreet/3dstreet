import en from './locales/en.json';
import es from './locales/es.json';
import ptBR from './locales/pt-BR.json';

/**
 * Flat id → string message catalogs, keyed by locale code. Catalogs are
 * generated: `en.json` is produced by `npm run i18n:extract` (formatjs scans
 * the source for FormattedMessage/defineMessages defaultMessages), and the
 * translated catalogs by `npm run i18n:translate`.
 *
 * Catalogs are small (UI strings only) so static import is fine; revisit with
 * dynamic import + code-splitting if they grow large.
 */
export const MESSAGES = {
  en,
  es,
  'pt-BR': ptBR
};
