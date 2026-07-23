/**
 * LanguageSelector - collapsible language picker for the shared profile menu.
 *
 * Renders a single "Language" row showing the current language; clicking it
 * expands the supported locales as a radio-style list (mirrors the editor's
 * Help → Language submenu, so the options aren't shown at all times). Switches
 * language through the framework-free `changeLocale` helper (localStorage +
 * broadcast + profile mirror). Used inside ProfileHoverCard in the generator
 * and Bollard Buddy, which don't mount react-intl; the surrounding shared
 * strings re-render live via useSharedMessages when the selection changes, and
 * the trigger value reflects the new language immediately.
 */
import { useState } from 'react';
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

const ChevronIcon = ({ open }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    style={{
      transform: open ? 'rotate(90deg)' : 'none',
      transition: 'transform 0.15s'
    }}
  >
    <path
      d="M9 6l6 6-6 6"
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
  const [expanded, setExpanded] = useState(false);

  // Endonyms are shown in their own language, never translated.
  const activeLabel =
    SUPPORTED_LOCALES.find(({ code }) => code === locale)?.label ?? '';

  return (
    <div className={styles.languageSection}>
      <button
        type="button"
        className={styles.languageTrigger}
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={styles.languageTriggerLabel}>{t('language')}</span>
        <span className={styles.languageTriggerValue}>
          {activeLabel}
          <ChevronIcon open={expanded} />
        </span>
      </button>

      {expanded && (
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
      )}
    </div>
  );
};

export default LanguageSelector;
