import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { createPortal } from 'react-dom';
import { isOfficialDeployment } from '@shared/utils/deployment.js';
import styles from './UnofficialDeploymentBanner.module.scss';

const DISMISS_KEY = '3dstreet:unofficialDeploymentBannerDismissed';

/**
 * Non-blocking notice shown on community / self-hosted builds (any non-official
 * domain). Tells users that local editing works but cloud features are wired to
 * the official 3DStreet servers and won't work here — so a forked deployment's
 * broken sign-in / save / generation isn't mistaken for a bug.
 *
 * Dismissal is per-session (sessionStorage), so it returns on the next visit
 * but doesn't nag within a session.
 */
const UnofficialDeploymentBanner = () => {
  const intl = useIntl();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Official builds (and SSR / no-window contexts) never show the banner.
  if (dismissed || isOfficialDeployment()) {
    return null;
  }

  const onDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // sessionStorage can throw in private mode / sandboxed iframes — the
      // banner just won't persist its dismissed state, which is acceptable.
    }
    setDismissed(true);
  };

  return createPortal(
    <div className={styles.banner} role="status">
      <span className={styles.message}>
        <FormattedMessage
          id="deploymentBanner.message"
          defaultMessage="You're using a forked or self-hosted build of 3DStreet (open source, AGPL-3.0). Local editing works, but cloud features are unavailable. To use cloud services, visit <link>3dstreet.app</link>."
          values={{
            link: (chunks) => (
              <a
                className={styles.link}
                href="https://3dstreet.app"
                target="_blank"
                rel="noreferrer"
              >
                {chunks}
              </a>
            )
          }}
        />
      </span>
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label={intl.formatMessage({
          id: 'deploymentBanner.dismiss',
          defaultMessage: 'Dismiss notice'
        })}
      >
        ×
      </button>
    </div>,
    document.body
  );
};

export default UnofficialDeploymentBanner;
