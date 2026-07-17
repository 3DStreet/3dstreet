/**
 * Minimal real-browser harness for validating the i18n catalogs (#656).
 *
 * It uses the SAME react-intl version and the SAME generated catalogs the app
 * ships, mounts an IntlProvider, and exposes a language switcher — but pulls in
 * none of the app's Firebase / A-Frame runtime, so it can be bundled and driven
 * by Playwright headlessly. The driver (validate-browser.mjs) bundles this with
 * esbuild, serves it, switches locales, and asserts rendered text matches the
 * catalogs.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntlProvider, FormattedMessage } from 'react-intl';
import enRaw from '../../../../src/editor/i18n/locales/en.json';
import es from '../../../../src/editor/i18n/locales/es.json';
import ptBR from '../../../../src/editor/i18n/locales/pt-BR.json';
import fr from '../../../../src/editor/i18n/locales/fr.json';

// Flatten the formatjs en.json ({ id: { defaultMessage } }) to { id: string }.
const en = Object.fromEntries(
  Object.entries(enRaw).map(([id, d]) => [
    id,
    typeof d === 'string' ? d : d.defaultMessage
  ])
);

const CATALOGS = { en, es, 'pt-BR': ptBR, fr };
const LOCALES = ['en', 'es', 'pt-BR', 'fr'];
const ids = Object.keys(en);

function Harness() {
  const [locale, setLocale] = useState('en');
  return (
    <IntlProvider
      locale={locale}
      defaultLocale="en"
      messages={CATALOGS[locale]}
    >
      <select
        data-testid="locale-select"
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <div data-testid="strings">
        {ids.map((id) => (
          <div key={id} data-key={id}>
            <FormattedMessage id={id} defaultMessage={en[id]} />
          </div>
        ))}
      </div>
    </IntlProvider>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
