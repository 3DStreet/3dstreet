import { useIntl } from 'react-intl';
import useStore from '../../../../store.js';
import { SUPPORTED_LOCALES, isI18nEnabled } from '../../../i18n/config.js';
import styles from './LanguagePreference.module.scss';

/**
 * Manual language switcher for the localization experiment (#656). Rendered in
 * the ActionBar next to the units toggle. Hidden entirely unless the i18n
 * feature flag is enabled, so English-only users never see it.
 */
export const LanguagePreference = () => {
  const intl = useIntl();
  const locale = useStore((state) => state.locale);
  const setLocale = useStore((state) => state.setLocale);

  if (!isI18nEnabled()) return null;

  return (
    <select
      className={styles.languageSelect}
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
      title={intl.formatMessage({
        id: 'actionBar.languageSwitcher',
        defaultMessage: 'Change language'
      })}
      aria-label={intl.formatMessage({
        id: 'actionBar.languageSwitcher',
        defaultMessage: 'Change language'
      })}
    >
      {SUPPORTED_LOCALES.map(({ code, label }) => (
        <option key={code} value={code}>
          {label}
        </option>
      ))}
    </select>
  );
};
