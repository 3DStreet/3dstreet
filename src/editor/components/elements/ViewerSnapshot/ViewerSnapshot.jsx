/* global STREET */
import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { faCamera } from '@fortawesome/free-solid-svg-icons';
import posthog from 'posthog-js';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import {
  captureScreenshotAsJpeg,
  saveScreenshotToGallery
} from '@/editor/api/snapshot';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import styles from './ViewerSnapshot.module.scss';

const TOAST_MS = 6000;

/**
 * Capture-only snapshot for the Viewer (#1824 Q2): instant capture, a
 * non-blocking toast with the thumbnail, and a background save to the
 * user's gallery when signed in. AI rendering is deferred to the
 * gallery (the editor keeps the richer Capture & Render modal). The
 * thumbnail is always click-to-download, which doubles as the
 * signed-out story.
 */
export const ViewerSnapshot = () => {
  const intl = useIntl();
  const { currentUser } = useAuthContext() || {};
  const isPro = currentUser?.isPro || currentUser?.isProTeam;
  // toast: null | { dataUrl, savedToGallery }
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const handleCapture = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { dataUrl, width, height } = await captureScreenshotAsJpeg(isPro);
      setToast({ dataUrl, savedToGallery: !!currentUser?.uid });
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setToast(null), TOAST_MS);

      posthog.capture('viewer_snapshot_taken', {
        scene_id: STREET.utils.getCurrentSceneId(),
        is_playing: useStore.getState().isPlaying,
        signed_in: !!currentUser?.uid
      });

      // Background gallery save — never blocks the toast or the sim.
      if (currentUser?.uid) {
        saveScreenshotToGallery(
          dataUrl,
          {
            source: 'viewer-snapshot',
            model: 'Viewer Snapshot',
            width,
            height,
            isPro
          },
          currentUser.uid
        ).catch((error) => {
          console.error('Failed to save snapshot to gallery:', error);
        });
      }
    } catch (error) {
      console.error('Viewer snapshot failed:', error);
      STREET.notify?.errorMessage(
        intl.formatMessage({
          id: 'viewer.snapshotFailed',
          defaultMessage: 'Snapshot failed. Please try again.'
        })
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (!toast) return;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const link = document.createElement('a');
    link.href = toast.dataUrl;
    link.download = `3dstreet-snapshot-${timestamp}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    posthog.capture('viewer_snapshot_downloaded', {
      scene_id: STREET.utils.getCurrentSceneId()
    });
  };

  const captureTitle = intl.formatMessage({
    id: 'viewer.snapshotTitle',
    defaultMessage: 'Capture a snapshot of this view'
  });

  return (
    <>
      <Button
        variant="toolbtn"
        onClick={handleCapture}
        disabled={busy}
        title={captureTitle}
        aria-label={captureTitle}
        leadingIcon={<AwesomeIcon icon={faCamera} size={16} />}
      />
      {toast && (
        <div className={styles.toast}>
          <img
            className={styles.thumb}
            src={toast.dataUrl}
            alt={intl.formatMessage({
              id: 'viewer.snapshotThumbAlt',
              defaultMessage: 'Captured snapshot — click to download'
            })}
            onClick={handleDownload}
          />
          <span className={styles.caption}>
            {toast.savedToGallery ? (
              <FormattedMessage
                id="viewer.snapshotSaved"
                defaultMessage="Saved to your gallery — click to download"
              />
            ) : (
              <FormattedMessage
                id="viewer.snapshotDownloadHint"
                defaultMessage="Click to download — sign in to save to your gallery"
              />
            )}
          </span>
        </div>
      )}
    </>
  );
};
