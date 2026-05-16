import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import * as Tooltip from '@radix-ui/react-tooltip';
import Modal from '@shared/components/Modal/Modal.jsx';
import { auth } from '@shared/services/firebase.js';
import { DownloadIcon, TrashIcon } from '@shared/icons';
import assetsService from '../services/assetsService.js';
import { formatBytes, formatDate } from '../utils.js';
import styles from './MeshDetailsModal.module.scss';

const IconTooltip = ({ children, label }) => (
  <Tooltip.Root delayDuration={150}>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side="top"
        sideOffset={6}
        className={styles.tooltipContent}
      >
        {label}
        <Tooltip.Arrow className={styles.tooltipArrow} />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);
IconTooltip.propTypes = {
  children: PropTypes.node.isRequired,
  label: PropTypes.string.isRequired
};

const MeshDetailsModal = ({ assetId, ownerUid, onClose, onPlace }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    assetsService
      .getAsset(assetId, ownerUid)
      .then((doc) => {
        if (cancelled) return;
        setData(doc || null);
        const initial = doc?.name || doc?.originalFilename || '';
        setName(initial);
        setSavedName(initial);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId, ownerUid]);

  const isOwner = !!auth.currentUser && auth.currentUser.uid === ownerUid;
  const dirty = isOwner && name.trim() !== savedName && name.trim() !== '';

  const onSaveName = async () => {
    if (!dirty || !data) return;
    setSaving(true);
    setError(null);
    try {
      const trimmed = name.trim();
      await assetsService.updateAsset(assetId, ownerUid, { name: trimmed });
      setData((prev) => (prev ? { ...prev, name: trimmed } : prev));
      setSavedName(trimmed);
    } catch (err) {
      console.error('[MeshDetailsModal] save failed', err);
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const onDownload = () => {
    if (!data?.storageUrl) return;
    const a = document.createElement('a');
    a.href = data.storageUrl;
    a.download = data.originalFilename || `${assetId}.glb`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const onDelete = async () => {
    if (!isOwner || !data) return;
    if (!window.confirm(`Delete "${savedName || data.originalFilename}"?`)) {
      return;
    }
    try {
      await assetsService.deleteAsset(assetId, ownerUid, false);
      onClose();
    } catch (err) {
      console.error('[MeshDetailsModal] delete failed', err);
      setError(err.message || 'Delete failed');
    }
  };

  const handlePlace = () => {
    if (!onPlace || !data) return;
    onPlace({
      assetId,
      ownerUid,
      storageUrl: data.storageUrl,
      name: savedName || data.name || data.originalFilename || '',
      type: data.type
    });
    onClose();
  };

  const title = savedName || data?.originalFilename || 'Asset';

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={true}
      onClose={onClose}
      titleElement={
        <div className={styles.title}>
          <svg
            className={styles.titleIcon}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          {title}
        </div>
      }
    >
      <div className={styles.wrapper}>
        <div className={styles.viewerArea}>
          {loading && <div className={styles.placeholder}>Loading…</div>}
          {!loading && !data && (
            <div className={`${styles.placeholder} ${styles.error}`}>
              Asset not available
            </div>
          )}
          {data && (
            <iframe
              className={styles.viewerFrame}
              title={savedName || data.originalFilename || '3D model'}
              // Don't put the editable name in the iframe URL — the src
              // string drives the iframe's load; baking savedName in
              // would cause model-viewer to reload on every Save name
              // click. The iframe title above is enough for a11y.
              src={`/model-viewer.html?src=${encodeURIComponent(data.storageUrl)}`}
            />
          )}
        </div>

        <div className={styles.sidebar}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="meshAssetName">
              Display name
            </label>
            <input
              id="meshAssetName"
              type="text"
              className={styles.fieldInput}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isOwner || saving || !data}
            />
            {dirty && (
              <button
                type="button"
                onClick={onSaveName}
                disabled={saving}
                className={styles.saveNameBtn}
              >
                {saving ? 'Saving…' : 'Save name'}
              </button>
            )}
          </div>

          <div className={styles.metaList}>
            <div>
              <span className={styles.metaLabel}>File:</span>
              {data?.originalFilename || '—'}
            </div>
            <div>
              <span className={styles.metaLabel}>Size:</span>
              {formatBytes(data?.size)}
            </div>
            <div>
              <span className={styles.metaLabel}>Type:</span>
              {data?.mimeType || '—'}
            </div>
            <div>
              <span className={styles.metaLabel}>Uploaded:</span>
              {formatDate(data?.uploadedAt || data?.createdAt)}
            </div>
            <div>
              <span className={styles.metaLabel}>Asset ID:</span>
              {assetId}
            </div>
            <div>
              <span className={styles.metaLabel}>Owner:</span>
              {isOwner ? 'you' : 'another user'}
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <Tooltip.Provider>
            <div className={styles.controlButtons}>
              {isOwner && (
                <IconTooltip label="Delete">
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={!data}
                    className={`${styles.iconButton} ${styles.deleteBtn}`}
                    aria-label="Delete"
                  >
                    <TrashIcon />
                  </button>
                </IconTooltip>
              )}
              <IconTooltip label="Download">
                <button
                  type="button"
                  onClick={onDownload}
                  disabled={!data}
                  className={styles.iconButton}
                  aria-label="Download"
                >
                  <DownloadIcon />
                </button>
              </IconTooltip>
              {onPlace && (
                <button
                  type="button"
                  onClick={handlePlace}
                  disabled={!data}
                  className={styles.primaryButton}
                >
                  Place in scene
                </button>
              )}
            </div>
          </Tooltip.Provider>
        </div>
      </div>
    </Modal>
  );
};

MeshDetailsModal.propTypes = {
  assetId: PropTypes.string.isRequired,
  ownerUid: PropTypes.string.isRequired,
  onClose: PropTypes.func.isRequired,
  // Optional: when provided, renders a "Place in scene" CTA. Called with
  // { assetId, ownerUid, storageUrl, name, type } when the user clicks it;
  // the modal closes itself after invoking. Only the gallery card open
  // path passes this — the props-panel "Details" button leaves it
  // undefined (the entity is already in the scene).
  onPlace: PropTypes.func
};

export default MeshDetailsModal;
