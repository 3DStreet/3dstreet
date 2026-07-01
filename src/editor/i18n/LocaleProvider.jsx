import { IntlProvider } from 'react-intl';
import useStore from '@/store';
import { MESSAGES } from './messages';
import { DEFAULT_LOCALE } from './config';

/**
 * Wraps the app in a react-intl IntlProvider driven by the `locale` value in
 * the Zustand store. The provider is always mounted (even when the i18n
 * experiment is off) so that `FormattedMessage`/`useIntl` work everywhere;
 * when the flag is off the store locale stays 'en' and the English catalog
 * (defaultMessages) is used.
 */
export function LocaleProvider({ children }) {
  const locale = useStore((state) => state.locale);
  const messages = MESSAGES[locale] || MESSAGES[DEFAULT_LOCALE];

  return (
    <IntlProvider
      locale={locale}
      defaultLocale={DEFAULT_LOCALE}
      messages={messages}
      onError={handleIntlError}
    >
      {children}
    </IntlProvider>
  );
}

/**
 * Translated catalogs are intentionally partial during rollout (keys are added
 * to en.json as strings get wrapped, then translated in a later pass). Swallow
 * the noisy MISSING_TRANSLATION warning — react-intl already falls back to the
 * English defaultMessage — but surface real problems (bad ICU syntax, etc.).
 */
function handleIntlError(err) {
  if (err.code === 'MISSING_TRANSLATION') return;
  if (process.env.NODE_ENV !== 'production') {
    console.error(err);
  }
}
