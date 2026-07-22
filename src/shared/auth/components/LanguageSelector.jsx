/**
 * LanguageSelector - language picker for the shared profile menu.
 *
 * Renders the supported locales as a radio-style list and switches language
 * through the framework-free `changeLocale` helper (localStorage + broadcast +
 * profile mirror). Used inside ProfileHoverCard in the generator and Bollard
 * Buddy, which don't mount react-intl; the surrounding shared strings re-render
 * live via useSharedMessages when the selection changes. The menu is left open
 * on select so that live re-render is visible feedback.
 */
import { useAuthContext } from '../../contexts';
import { SUPPORTED_LOCALES } from '../../i18n/locales';
import { useSharedLocale, useSharedMessages } from '../../i18n/sharedMessages';
import { changeLocale } from '../../i18n/changeLocale';
import styles from './ProfileHoverCard.module.scss';

const CheckIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M20 6L9 17l-5-5"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const LanguageSelector = () => {
  const { currentUser } = useAuthContext();
  const locale = useSharedLocale();
  const t = useSharedMessages();

  return (
    <div className={styles.languageSection}>
      <div className={styles.languageLabel}>{t('language')}</div>
      <div
        className={styles.languageOptions}
        role="radiogroup"
        aria-label={t('language')}
      >
        {SUPPORTED_LOCALES.map(({ code, label }) => {
          const active = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              className={`${styles.languageOption} ${
                active ? styles.languageOptionActive : ''
              }`}
              onClick={() => changeLocale(code, { uid: currentUser?.uid })}
            >
              {/* Endonyms are shown in their own language, never translated. */}
              <span>{label}</span>
              {active && <CheckIcon />}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LanguageSelector;
