import { useState } from 'react';
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

  return (
    <div className={styles.banner} role="status">
      <span className={styles.message}>
        You’re using a community or self-hosted build of 3DStreet (open source,
        AGPL-3.0). Local editing works fully, but cloud features — sign-in,
        saving, AI generation, and payments — connect to the official 3DStreet
        servers and are unavailable here. For the full experience, visit{' '}
        <a
          className={styles.link}
          href="https://3dstreet.app"
          target="_blank"
          rel="noreferrer"
        >
          3dstreet.app
        </a>
        .
      </span>
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label="Dismiss notice"
      >
        ×
      </button>
    </div>
  );
};

export default UnofficialDeploymentBanner;
