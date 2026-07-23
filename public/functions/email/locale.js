/**
 * Email locale resolution for lifecycle emails (#1841).
 *
 * The editor UI ships in en / es / pt-BR / fr (react-intl); lifecycle emails
 * localize against the same set. The signal lives on the user's
 * socialProfile doc, written client-side:
 *
 *   socialProfile/{uid}.locale         — explicit View > Language pick
 *                                        (store.js setLocale / profile sync)
 *   socialProfile/{uid}.detectedLocale — navigator.language captured on
 *                                        sign-in (shared Auth context)
 *
 * Explicit choice wins over detection; anything unknown falls back to 'en'.
 * The matching below mirrors matchSupportedLocale in
 * src/shared/i18n/locales.js — keep the two in sync (functions are CommonJS
 * and can't import the ESM shared module).
 */

const EMAIL_LOCALES = ['en', 'es', 'pt-BR', 'fr'];
const DEFAULT_EMAIL_LOCALE = 'en';

/**
 * Map a raw BCP-47 tag to a supported email locale. Region-insensitive for
 * Spanish and French; any pt-* prefers Brazilian Portuguese (the cohort we
 * target). Unknown/empty tags resolve to the default.
 */
const normalizeEmailLocale = (tag) => {
  if (!tag) return DEFAULT_EMAIL_LOCALE;
  if (EMAIL_LOCALES.includes(tag)) return tag;
  const lower = String(tag).toLowerCase();
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('fr')) return 'fr';
  return DEFAULT_EMAIL_LOCALE;
};

/** Raw locale signal from the profile (explicit > detected), or null. */
const readProfileLocale = async (db, uid) => {
  const snap = await db.collection('socialProfile').doc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return data?.locale || data?.detectedLocale || null;
};

/**
 * Resolve the locale to send a lifecycle email in. Never throws — a failed
 * lookup must degrade to English, not block the send.
 */
const resolveEmailLocale = async (db, uid) => {
  try {
    return normalizeEmailLocale(await readProfileLocale(db, uid));
  } catch (err) {
    console.warn(`resolveEmailLocale failed for ${uid}, using default:`, err);
    return DEFAULT_EMAIL_LOCALE;
  }
};

/**
 * Bounded wait for the locale signal to appear. Exists for one race: the
 * welcome email fires on Auth onCreate, which can beat the client's
 * detectedLocale write by a few seconds — and a wrong-language welcome is
 * the most visible failure this feature exists to fix. Polls until the
 * profile carries a locale signal or attempts run out (default ~9s total),
 * then resolves like resolveEmailLocale.
 */
const waitForEmailLocale = async (
  db,
  uid,
  { attempts = 4, delayMs = 3000 } = {}
) => {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const raw = await readProfileLocale(db, uid);
      if (raw) return normalizeEmailLocale(raw);
    } catch (err) {
      console.warn(`waitForEmailLocale read failed for ${uid}:`, err);
    }
  }
  return DEFAULT_EMAIL_LOCALE;
};

module.exports = {
  EMAIL_LOCALES,
  DEFAULT_EMAIL_LOCALE,
  normalizeEmailLocale,
  resolveEmailLocale,
  waitForEmailLocale
};
