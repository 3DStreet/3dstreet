/**
 * PendingUploadCard - pinned at the top of the asset grid while a single
 * upload is in flight. Driven by useCurrentUploadStore; both the editor's
 * uploadAndPlaceAsset and the shared scene-free uploadAsset write to it.
 *
 * Renders nothing when no upload is active. Errors are surfaced via the
 * existing notification toasts and (for the editor placeholder flow) the
 * sidebar/scenegraph indicators, not on this card.
 */

import { useCurrentUploadStore } from '@shared/assets';
import { formatBytes } from '../utils.js';
import styles from './Assets.module.scss';

const STATUS_LABELS = {
  validating: 'Validating…',
  optimizing: 'Optimizing…',
  uploading: 'Uploading…',
  thumbnailing: 'Finishing…',
  finishing: 'Finishing…'
};

const PendingUploadCard = () => {
  const upload = useCurrentUploadStore((s) => s.upload);
  if (!upload) return null;

  const label = STATUS_LABELS[upload.status] || 'Uploading…';
  const pct = Math.max(0, Math.min(100, Math.round(upload.progress || 0)));

  return (
    <div className={styles.pendingCard} title={upload.filename}>
      <div className={styles.pendingSpinner} aria-hidden="true" />
      <div className={styles.pendingBody}>
        <div className={styles.pendingStatus}>{label}</div>
        {upload.filename && (
          <div className={styles.pendingFilename}>{upload.filename}</div>
        )}
        {upload.sizeBytes > 0 && (
          <div className={styles.pendingSize}>
            {formatBytes(upload.sizeBytes)}
          </div>
        )}
      </div>
      <div className={styles.pendingProgressTrack}>
        <div
          className={styles.pendingProgressFill}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

export default PendingUploadCard;
