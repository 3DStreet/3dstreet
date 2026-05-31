/**
 * PendingJobCard - pinned near the top of the asset grid while an async
 * generation job (image → splat today) is processing. Presentational: the
 * caller (AssetsContent) sources jobs from the live Firestore listener in
 * useAssets, so cards survive a reload and appear across tabs.
 *
 * Mirrors PendingUploadCard, with two differences: there's no source thumbnail
 * (the input image isn't retained by design — intentionally a spinner only),
 * and progress is indeterminate (jobs report a status, not a percentage).
 *
 * The job becomes a real asset on success; when it leaves the non-terminal set
 * the listener drops this card and refreshes the grid, so the card visibly
 * "turns into" the finished asset.
 */

import styles from './Assets.module.scss';

// Map normalized job status → user-facing label. `saving` is the server
// persisting the result to the gallery (the last step before it appears).
const STATUS_LABELS = {
  queued: 'Queued…',
  running: 'Generating…',
  saving: 'Finishing…'
};

// Map job kind → the noun shown on the card.
const KIND_NOUNS = {
  splat: 'Splat',
  image: 'Image'
};

const PendingJobCard = ({ job }) => {
  if (!job) return null;

  const label = STATUS_LABELS[job.status] || 'Processing…';
  const noun = KIND_NOUNS[job.kind] || 'Asset';
  const name = job.assetName || job.name || `${noun} generation`;

  return (
    <div className={styles.pendingCard} title={name}>
      <div className={styles.pendingSpinner} aria-hidden="true" />
      <div className={styles.pendingBody}>
        <div className={styles.pendingStatus}>{label}</div>
        <div className={styles.pendingFilename}>{name}</div>
      </div>
      <div className={styles.pendingProgressTrack}>
        <div className={styles.pendingProgressIndeterminate} />
      </div>
    </div>
  );
};

export default PendingJobCard;
