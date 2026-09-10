/* global AFRAME, STREET */
import { useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import { faArrowLeft, faXmark } from '@fortawesome/free-solid-svg-icons';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import styles from './FocusHotspotPanel.module.scss';

const getHotspotSystem = () =>
  AFRAME.scenes[0]?.systems?.['focus-hotspot'] ?? null;

/**
 * Viewer overlay for a focused hotspot: the author's title and
 * description plus the "Back to overview" affordance that returns the
 * camera to where the visitor was before their first hotspot click.
 * State is mirrored from the focus-hotspot A-Frame system via the store;
 * the panel never owns the focus lifecycle, it only renders and forwards
 * the two exits (back / close) to the system.
 */
export const FocusHotspotPanel = () => {
  const focusedHotspot = useStore((state) => state.focusedHotspot);

  useEffect(() => {
    if (!focusedHotspot) return;
    posthog.capture('hotspot_focused', {
      scene_id: STREET.utils.getCurrentSceneId(),
      has_description: !!focusedHotspot.description
    });
  }, [focusedHotspot]);

  if (!focusedHotspot) return null;

  const handleBack = () => getHotspotSystem()?.returnToOverview();
  // Close dismisses the panel but leaves the camera where it is — the
  // visitor may want to keep exploring the detail area free of UI.
  const handleClose = () => getHotspotSystem()?.clearFocus();

  return (
    <div className={`clickable ${styles.panel}`}>
      <button
        className={styles.closeButton}
        onClick={handleClose}
        aria-label="Close"
      >
        <AwesomeIcon icon={faXmark} size={14} />
      </button>
      {focusedHotspot.title && (
        <h2 className={styles.title}>{focusedHotspot.title}</h2>
      )}
      {focusedHotspot.description && (
        <p className={styles.description}>{focusedHotspot.description}</p>
      )}
      <Button
        variant="toolbtn"
        onClick={handleBack}
        leadingIcon={<AwesomeIcon icon={faArrowLeft} size={14} />}
      >
        <FormattedMessage
          id="viewer.hotspotBackToOverview"
          defaultMessage="Back to overview"
        />
      </Button>
    </div>
  );
};
