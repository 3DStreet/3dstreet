/* global STREET */
import { useEffect } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import posthog from 'posthog-js';
import { AwesomeIcon } from '../AwesomeIcon';
import styles from './HandoffPrompt.module.scss';

/**
 * Shown when Open in 3DStreet's new tab was blocked (sceneHandoff.js
 * resolves `opened: false`). The design is already in `url`, so nothing is
 * lost: Open is a plain link, which a fresh click lets through any popup
 * blocker, and Copy link keeps the design for a blocker that still says
 * no. Escape closes the prompt first, before it can deselect or stop play.
 */
export function HandoffPrompt({ url, onClose }) {
  const intl = useIntl();

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.code !== 'Escape') return;
      // Window capture phase, the first listener to run: the dock's
      // Escape (BuildPalette, document capture) and the viewer's (Toolbar)
      // see defaultPrevented, so this press only closes the prompt, not
      // also deselecting the object or stopping play.
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const copyLink = async () => {
    posthog.capture('visitor_build_handoff_copy_link');
    try {
      await navigator.clipboard.writeText(url);
      STREET.notify?.successMessage(
        intl.formatMessage({
          id: 'viewer.handoffPrompt.copied',
          defaultMessage:
            'Link copied. Paste it into a new tab to open your design.'
        })
      );
      onClose();
    } catch {
      STREET.notify?.errorMessage(
        intl.formatMessage({
          id: 'viewer.handoffPrompt.copyFailed',
          defaultMessage: 'Could not copy the link. Please try Open instead.'
        })
      );
    }
  };

  return (
    <div
      className={`clickable ${styles.prompt}`}
      role="dialog"
      aria-labelledby="handoff-prompt-title"
      id="handoff-prompt"
    >
      <div className={styles.header}>
        <span id="handoff-prompt-title" className={styles.title}>
          <FormattedMessage
            id="viewer.handoffPrompt.title"
            defaultMessage="Your design is ready"
          />
        </span>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label={intl.formatMessage({
            id: 'viewer.handoffPrompt.close',
            defaultMessage: 'Close'
          })}
        >
          <AwesomeIcon icon={faXmark} size={14} />
        </button>
      </div>
      <p className={styles.body}>
        <FormattedMessage
          id="viewer.handoffPrompt.body"
          defaultMessage="Your browser blocked the new tab. Open it here, or copy the link to keep your design."
        />
      </p>
      <div className={styles.actions}>
        <a
          className={styles.primary}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            posthog.capture('visitor_build_handoff_open_link');
            onClose();
          }}
        >
          <FormattedMessage
            id="viewer.handoffPrompt.open"
            defaultMessage="Open in 3DStreet"
          />
        </a>
        <button type="button" className={styles.secondary} onClick={copyLink}>
          <FormattedMessage
            id="viewer.handoffPrompt.copy"
            defaultMessage="Copy link"
          />
        </button>
      </div>
    </div>
  );
}
