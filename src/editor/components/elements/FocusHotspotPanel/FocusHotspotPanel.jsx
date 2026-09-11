/* global AFRAME, STREET */
import { useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import styles from './FocusHotspotPanel.module.scss';

const getHotspotSystem = () =>
  AFRAME.scenes[0]?.systems?.['focus-hotspot'] ?? null;

/**
 * Viewer overlay for a focused hotspot: the layer name as title, the
 * author's description, and one exit, Back, which returns the camera to
 * where the visitor was before their first hotspot click (Escape does the
 * same). There is deliberately no close/dismiss: while focused the panel
 * is the visitor's only way out, so it stays until they take it. State is
 * mirrored from the focus-hotspot A-Frame system via the store; the panel
 * never owns the focus lifecycle.
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

  return (
    <div className={`clickable ${styles.panel}`}>
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
        <FormattedMessage id="viewer.hotspotBack" defaultMessage="Back" />
      </Button>
    </div>
  );
};
