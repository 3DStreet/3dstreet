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
import { useSharedMessages } from '@shared/i18n/sharedMessages.js';
import { getUploadStageLabel } from '../uploadStageLabels.js';
import styles from './Assets.module.scss';

const CANCELLABLE_STATUSES = new Set(['validating', 'optimizing', 'uploading']);

const PendingUploadCard = () => {
  const upload = useCurrentUploadStore((s) => s.upload);
  const cancel = useCurrentUploadStore((s) => s.cancel);
  const t = useSharedMessages();
  if (!upload) return null;

  const pct = Math.max(0, Math.min(100, Math.round(upload.progress || 0)));
  // Same table as the editor's properties panel, so both say the same thing
  // at the same moment (#1989).
  const label =
    getUploadStageLabel(t, upload.status, upload.progress) ||
    t('uploadStageUploading');

  return (
    <div className={styles.pendingCard} title={upload.filename}>
      {upload.thumbnailUrl && (
        <img
          src={upload.thumbnailUrl}
          alt=""
          className={styles.pendingThumbnail}
          aria-hidden="true"
        />
      )}
      {!upload.thumbnailUrl && (
        <div className={styles.pendingSpinner} aria-hidden="true" />
      )}
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
        {CANCELLABLE_STATUSES.has(upload.status) && (
          <button
            type="button"
            className={styles.pendingCancelBtn}
            onClick={cancel}
          >
            Cancel
          </button>
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
