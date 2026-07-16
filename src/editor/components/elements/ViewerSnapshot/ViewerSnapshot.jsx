/* global STREET */
import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { faCamera } from '@fortawesome/free-solid-svg-icons';
import posthog from 'posthog-js';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { takeScreenshotWithOptions } from '@/editor/api/scene';
import { getCurrentCameraState } from '@/editor/lib/cameraUtils';
import { assetsService } from '@shared/assets';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import styles from './ViewerSnapshot.module.scss';

const TOAST_MS = 6000;

/**
 * Capture the current frame via screentock into the (always-mounted,
 * hidden) #screentock-destination img, then re-encode as JPEG. Returns
 * a data URL plus dimensions. Purely read-only: no pause, no modal —
 * a running simulation (or drive run) is never interrupted.
 */
async function captureFrame(isPro) {
  const imgEl = document.getElementById('screentock-destination');
  if (!imgEl) throw new Error('screenshot destination not found');
  const loaded = new Promise((resolve) =>
    imgEl.addEventListener('load', resolve, { once: true })
  );
  await takeScreenshotWithOptions({
    type: 'img',
    showLogo: !isPro,
    showWatermark: !isPro,
    imgElementSelector: '#screentock-destination'
  });
  await loaded;

  // Re-encode the PNG data URI as JPEG — much smaller for the gallery
  // upload and the local download (same approach as ScreenshotModal).
  const img = new Image();
  img.src = imgEl.src;
  await new Promise((resolve) => {
    img.onload = resolve;
    if (img.complete) resolve();
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.95),
    width: img.width,
    height: img.height
  };
}

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
      const { dataUrl, width, height } = await captureFrame(isPro);
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
        (async () => {
          try {
            await assetsService.init();
            await assetsService.addAsset(
              dataUrl,
              {
                timestamp: new Date().toISOString(),
                sceneId: STREET.utils.getCurrentSceneId(),
                sceneTitle: useStore.getState().sceneTitle || 'Untitled',
                source: 'viewer-snapshot',
                model: 'Viewer Snapshot',
                width,
                height,
                // Persist the capture pose so the gallery can offer a
                // "focus" button that returns the camera here (#1605).
                cameraState: getCurrentCameraState(),
                isPro: !!isPro
              },
              'image',
              'screenshot',
              currentUser.uid
            );
          } catch (error) {
            console.error('Failed to save snapshot to gallery:', error);
          }
        })();
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
