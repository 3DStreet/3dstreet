/**
 * MeshDetailsModal — self-contained portal modal (backdrop + frame in this
 * module's own SCSS). Does NOT use the shared <Modal> component because that
 * relies on global `.modal-*` rules from editor/style/textureModal.scss,
 * which aren't loaded in the generator or bollardbuddy bundles.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import * as Tooltip from '@radix-ui/react-tooltip';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@shared/services/firebase.js';
import { DownloadIcon, TrashIcon, Cross24Icon } from '@shared/icons';
import { composeAttributionString } from '@shared/asset-upload/extractGlbAttribution.js';
import assetsService from '../services/assetsService.js';
import {
  formatBytes,
  formatDate,
  getOptimizationDisplay,
  getServedUrl
} from '../utils.js';
import styles from './MeshDetailsModal.module.scss';

// User-editable attribution fields. `title` deliberately is NOT here — the
// asset doc's `name` (Display name) is the single source of truth for the
// model title. sourceName / generator are diagnostic, surfaced read-only.
const ATTRIBUTION_FIELDS = ['author', 'license', 'source'];

const EMPTY_ATTRIBUTION = {
  author: '',
  license: '',
  source: '',
  sourceName: '',
  generator: ''
};

function pickAttribution(doc) {
  const a = doc?.attribution || {};
  return {
    author: a.author || '',
    license: a.license || '',
    source: a.source || '',
    sourceName: a.sourceName || '',
    generator: a.generator || ''
  };
}

function attributionEquals(a, b) {
  for (const key of ATTRIBUTION_FIELDS) {
    if ((a[key] || '') !== (b[key] || '')) return false;
  }
  return true;
}

// True if the drawn frame is essentially pure black — i.e. the WebGL canvas was
// captured before the viewer rendered its first frame. Samples a sparse stride
// of pixels and checks peak luminance; the viewer's #393939 background alone
// (~lum 57) clears this bar, so only a genuinely unrendered (black) buffer is
// rejected. Best-effort: if the pixels can't be read, don't block the capture.
function isFrameBlank(ctx, w, h) {
  try {
    const { data: px } = ctx.getImageData(0, 0, w, h);
    let maxLum = 0;
    const stride = 4 * 101; // sparse, prime-ish sample for speed
    for (let i = 0; i + 2 < px.length; i += stride) {
      const lum = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      if (lum > maxLum) maxLum = lum;
    }
    return maxLum < 8;
  } catch {
    return false;
  }
}

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

const MeshDetailsModal = ({
  assetId,
  ownerUid,
  onClose,
  onPlace,
  currentIndex,
  totalItems,
  onNavigate
}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [savedName, setSavedName] = useState('');
  const [attribution, setAttribution] = useState(EMPTY_ATTRIBUTION);
  const [savedAttribution, setSavedAttribution] = useState(EMPTY_ATTRIBUTION);
  const [editingAttribution, setEditingAttribution] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Latest close handler, read by the keydown effect (which is set up once).
  const onCloseRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEditingAttribution(false);
    assetsService
      .getAsset(assetId, ownerUid)
      .then((doc) => {
        if (cancelled) return;
        setData(doc || null);
        const initial = doc?.name || doc?.originalFilename || '';
        setName(initial);
        setSavedName(initial);
        const attr = pickAttribution(doc);
        setAttribution(attr);
        setSavedAttribution(attr);
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

  // Keyboard nav — mirrors AssetsModal.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowLeft' && onNavigate) onNavigate('prev');
      else if (e.key === 'ArrowRight' && onNavigate) onNavigate('next');
      else if (e.key === 'Escape') onCloseRef.current?.();
    };
    // Capture phase — see AssetsModal for why (SceneGraph's onKeyDown
    // stopPropagation()s arrow keys in bubble phase before they reach window).
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onNavigate]);

  // Lazy splat-thumbnail backfill: the splat-viewer iframe captures a frame of
  // the loaded splat and postMessages it up. If this splat has no thumbnail yet
  // and we're the owner (only the owner may write to their asset path), upload
  // it so the gallery card stops showing a blank .ply placeholder. Best-effort,
  // at most once per asset (the assetUpdated event then refreshes the card).
  const thumbUploadedRef = useRef(null);
  useEffect(() => {
    const isOwnerNow = !!auth.currentUser && auth.currentUser.uid === ownerUid;
    if (!data || data.type !== 'splat' || !isOwnerNow) return;
    if (data.thumbnailUrl || thumbUploadedRef.current === assetId) return;
    const expectedSrc = getServedUrl(data);
    const onMessage = (e) => {
      const msg = e.data;
      if (
        !msg ||
        msg.type !== '3dstreet:splat-thumbnail' ||
        !(msg.blob instanceof Blob)
      ) {
        return;
      }
      // The viewer echoes the src it captured; ignore a stale capture that
      // arrived after the user navigated to a different asset.
      if (msg.src && msg.src !== expectedSrc) return;
      if (thumbUploadedRef.current === assetId) return;
      thumbUploadedRef.current = assetId;
      import('@shared/asset-upload')
        .then(({ uploadCapturedThumbnail }) =>
          uploadCapturedThumbnail(assetId, ownerUid, msg.blob, 'splats')
        )
        .catch((err) =>
          console.warn('[MeshDetailsModal] splat thumbnail upload failed', err)
        );
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [data, assetId, ownerUid]);

  const iframeRef = useRef(null);
  const isOwner = !!auth.currentUser && auth.currentUser.uid === ownerUid;

  // Synchronous fallback for when the user closes before the viewer's better
  // auto-framed capture fires: read whatever the iframe canvas currently shows
  // (same-origin) and upload it. Lower quality (live view, maybe mid-LOD) but
  // guarantees a thumbnail. Must run while the modal is still open — a ref read
  // in an unmount effect would already be nulled — so it's wired through the
  // explicit close affordances via handleClose, not a cleanup.
  const captureCurrentFrame = () => {
    if (!data || data.type !== 'splat' || !isOwner) return;
    if (data.thumbnailUrl || thumbUploadedRef.current === assetId) return;
    try {
      const glCanvas =
        iframeRef.current?.contentDocument?.querySelector('canvas');
      if (!glCanvas || !glCanvas.width || !glCanvas.height) return;
      const maxDim = 512;
      const scale = Math.min(
        1,
        maxDim / Math.max(glCanvas.width, glCanvas.height)
      );
      const tw = Math.max(1, Math.round(glCanvas.width * scale));
      const th = Math.max(1, Math.round(glCanvas.height * scale));
      const tmp = document.createElement('canvas');
      tmp.width = tw;
      tmp.height = th;
      const tctx = tmp.getContext('2d');
      tctx.drawImage(glCanvas, 0, 0, tw, th);
      // The viewer only begins rendering on its first animation frame; if the
      // user closes before that, the GL canvas is still an uncleared (black)
      // buffer. Persisting that gives a black thumbnail that then sticks (the
      // doc has a thumbnailUrl, so the proper offscreen capture never replaces
      // it). Skip a blank frame and leave the asset thumbnail-less so a later
      // open — or the viewer's own 3s offscreen capture — can backfill a real
      // one. Don't set thumbUploadedRef, so this isn't treated as "done".
      if (isFrameBlank(tctx, tw, th)) return;
      thumbUploadedRef.current = assetId;
      tmp.toBlob(
        (blob) => {
          if (!blob) return;
          import('@shared/asset-upload')
            .then(({ uploadCapturedThumbnail }) =>
              uploadCapturedThumbnail(assetId, ownerUid, blob, 'splats')
            )
            .catch(() => {});
        },
        'image/jpeg',
        0.82
      );
    } catch {
      // iframe not ready / not same-origin — skip the fallback silently.
    }
  };

  const handleClose = () => {
    captureCurrentFrame();
    onClose();
  };
  onCloseRef.current = handleClose;
  const nameDirty = isOwner && name.trim() !== savedName && name.trim() !== '';
  const attributionDirty =
    isOwner && !attributionEquals(attribution, savedAttribution);
  const dirty = nameDirty || attributionDirty;

  const onSave = async () => {
    if (!dirty || !data) return;
    setSaving(true);
    setError(null);
    try {
      const updates = {};
      let nextName = savedName;
      if (nameDirty) {
        nextName = name.trim();
        updates.name = nextName;
      }
      let nextAttribution = savedAttribution;
      if (attributionDirty) {
        const trimmed = ATTRIBUTION_FIELDS.reduce(
          (acc, key) => {
            acc[key] = (attribution[key] || '').trim();
            return acc;
          },
          {
            sourceName: savedAttribution.sourceName || '',
            generator: savedAttribution.generator || ''
          }
        );
        const attributionStr = composeAttributionString(trimmed);
        updates.attribution = {
          ...trimmed,
          attribution: attributionStr,
          attributionUrl: trimmed.source
        };
        nextAttribution = { ...trimmed };
      }
      await assetsService.updateAsset(assetId, ownerUid, updates);
      setData((prev) => (prev ? { ...prev, ...updates } : prev));
      if (nameDirty) setSavedName(nextName);
      if (attributionDirty) {
        setSavedAttribution(nextAttribution);
        setAttribution(nextAttribution);
      }
      setEditingAttribution(false);
    } catch (err) {
      console.error('[MeshDetailsModal] save failed', err);
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const cancelAttributionEdit = () => {
    setAttribution(savedAttribution);
    setEditingAttribution(false);
  };

  const onDownloadOriginal = () => {
    if (!data?.storageUrl) return;
    window.open(data.storageUrl);
  };

  const onDownloadOptimized = () => {
    if (!data?.optimizedSourceUrl) return;
    window.open(data.optimizedSourceUrl);
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

  const onRestore = async () => {
    if (!isOwner || !data) return;
    setError(null);
    try {
      // Soft-delete dropped this asset's bytes from the user's usage tally
      // (asset-quota.js onAssetWritten subtracts deleted docs). Restoring
      // adds them back — so check headroom first.
      const proposedBytes = Number(data.size) || 0;
      try {
        const callable = httpsCallable(functions, 'getUploadQuota');
        const { data: quota } = await callable({ proposedBytes });
        if (quota && quota.allowed === false && !quota.soft) {
          const usedMb = ((quota.bytesUsed || 0) / 1000 / 1000).toFixed(1);
          const limitMb = Math.round((quota.planLimit || 0) / 1000 / 1000);
          const restoreMb = (proposedBytes / 1000 / 1000).toFixed(1);
          setError(
            `Not enough storage to restore (${restoreMb} MB needed; ${usedMb} / ${limitMb} MB used). Delete other assets or upgrade.`
          );
          return;
        }
      } catch (quotaErr) {
        // If the callable is unavailable, fall through and let the write
        // attempt — server still tracks usage even if it can't pre-flight.
        console.warn(
          '[MeshDetailsModal] quota check unavailable, proceeding',
          quotaErr
        );
      }

      await assetsService.undeleteAsset(assetId, ownerUid);
      // Refresh local state so the banner and button disappear without
      // closing the modal — the user might want to keep editing.
      setData((prev) => (prev ? { ...prev, deleted: false } : prev));
    } catch (err) {
      console.error('[MeshDetailsModal] restore failed', err);
      setError(err.message || 'Restore failed');
    }
  };

  const handlePlace = () => {
    if (!onPlace || !data) return;
    onPlace({
      assetId,
      ownerUid,
      storageUrl: data.storageUrl,
      optimizedSourceUrl: data.optimizedSourceUrl,
      name: savedName || data.name || data.originalFilename || '',
      type: data.type
    });
    handleClose();
  };

  // Use mousedown, not click: a `click` fires on the common ancestor of
  // mousedown+mouseup, so dragging from an input inside the modal to a
  // mouseup on the backdrop would land `click` on the backdrop and close.
  // Closing on mousedown only triggers when the press itself starts here.
  const handleBackgroundMouseDown = (e) => {
    if (e.target === e.currentTarget) handleClose();
  };

  // This modal serves both meshes (GLB) and splats (.ply/.splat/.spz). The
  // only type-dependent bits are the live viewer page and the type label.
  const isSplat = data?.type === 'splat';
  const viewerPage = isSplat ? '/splat-viewer.html' : '/model-viewer.html';

  // Canonical "{Type} · {Source}" title — matches the gallery card overlay
  // and the image/video modal. The source label is the editable display name,
  // so the live `savedName` takes precedence over `data.name` (which only
  // refreshes after the doc reloads).
  const title = `${isSplat ? 'Splat' : 'Model'} · ${
    savedName || data?.name || data?.originalFilename || 'Untitled'
  }`;
  const showNav = onNavigate && totalItems > 1;
  const hasPrev = showNav && currentIndex > 0;
  const hasNext = showNav && currentIndex < totalItems - 1;

  return createPortal(
    <div className={styles.modal} onMouseDown={handleBackgroundMouseDown}>
      {hasPrev && (
        <button
          type="button"
          className={`${styles.navButton} ${styles.navButtonPrev}`}
          onClick={(e) => {
            e.stopPropagation();
            onNavigate('prev');
          }}
          title="Previous (←)"
          aria-label="Previous item"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          className={`${styles.navButton} ${styles.navButtonNext}`}
          onClick={(e) => {
            e.stopPropagation();
            onNavigate('next');
          }}
          title="Next (→)"
          aria-label="Next item"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>
      )}

      <div className={styles.modalContent}>
        <div className={styles.modalHeader}>
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
          <button
            type="button"
            className={styles.closeBtn}
            onClick={handleClose}
            aria-label="Close"
          >
            <Cross24Icon />
          </button>
        </div>

        <div className={styles.wrapper}>
          <div className={styles.viewerArea}>
            {!loading && !data && (
              <div className={`${styles.placeholder} ${styles.error}`}>
                Asset not available
              </div>
            )}
            {data && (
              <iframe
                ref={iframeRef}
                className={styles.viewerFrame}
                title={savedName || data.originalFilename || '3D model'}
                // Don't put the editable name in the iframe URL — the src
                // string drives the iframe's load; baking savedName in
                // would cause the viewer to reload on every Save name
                // click. The iframe title above is enough for a11y.
                src={`${viewerPage}?src=${encodeURIComponent(getServedUrl(data))}`}
              />
            )}
          </div>

          <div className={styles.sidebar}>
            {data?.deleted && (
              <div className={styles.deletedBanner} role="alert">
                <strong>Marked for deletion</strong>
                <span>
                  This model will be permanently purged on the next cleanup
                  pass. Restore it to keep using it in your scenes.
                </span>
              </div>
            )}
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
            </div>

            <AttributionBlock
              attribution={attribution}
              setAttribution={setAttribution}
              editing={editingAttribution}
              onEnterEdit={() => setEditingAttribution(true)}
              onCancel={cancelAttributionEdit}
              isOwner={isOwner && !!data}
              disabled={saving || !data}
            />

            {dirty && (
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className={styles.saveNameBtn}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            )}

            <div className={styles.metaList}>
              <div>
                <span className={styles.metaLabel}>File:</span>
                {data?.originalFilename || '—'}
              </div>
              <div>
                <span className={styles.metaLabel}>Size:</span>
                {(() => {
                  const opt = getOptimizationDisplay(data);
                  if (opt.skipReason) {
                    return (
                      <>
                        {formatBytes(opt.origSize)}{' '}
                        <span className={styles.optimizationNote}>
                          ({opt.skipReason})
                        </span>
                      </>
                    );
                  }
                  if (opt.optSize) {
                    return (
                      <>
                        {formatBytes(opt.origSize)} → {formatBytes(opt.optSize)}{' '}
                        <span className={styles.optimizationSaved}>
                          (−{opt.savePct}%)
                        </span>
                      </>
                    );
                  }
                  return formatBytes(opt.origSize);
                })()}
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
                {isOwner &&
                  !loading &&
                  (data?.deleted ? (
                    <IconTooltip label="Restore">
                      <button
                        type="button"
                        onClick={onRestore}
                        disabled={!data}
                        className={`${styles.iconButton} ${styles.restoreBtn}`}
                        aria-label="Restore"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 12a9 9 0 1 0 3-6.7" />
                          <polyline points="3 4 3 10 9 10" />
                          <polyline points="12 7 12 12 15 14" />
                        </svg>
                      </button>
                    </IconTooltip>
                  ) : (
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
                  ))}
                {data?.optimizedSourceUrl ? (
                  <>
                    <IconTooltip label="Download original">
                      <button
                        type="button"
                        onClick={onDownloadOriginal}
                        disabled={!data}
                        className={`${styles.iconButton} ${styles.downloadLabelBtn}`}
                        aria-label="Download original"
                      >
                        <DownloadIcon />
                        <span className={styles.downloadBtnLabel}>Orig</span>
                      </button>
                    </IconTooltip>
                    <IconTooltip label="Download optimized">
                      <button
                        type="button"
                        onClick={onDownloadOptimized}
                        disabled={!data}
                        className={`${styles.iconButton} ${styles.downloadLabelBtn}`}
                        aria-label="Download optimized"
                      >
                        <DownloadIcon />
                        <span className={styles.downloadBtnLabel}>Opt</span>
                      </button>
                    </IconTooltip>
                  </>
                ) : (
                  <IconTooltip label="Download">
                    <button
                      type="button"
                      onClick={onDownloadOriginal}
                      disabled={!data}
                      className={styles.iconButton}
                      aria-label="Download"
                    >
                      <DownloadIcon />
                    </button>
                  </IconTooltip>
                )}
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
      </div>
    </div>,
    document.body
  );
};

// Attribution block — switches between a compact read-only view (composed
// string + clickable source link) and an inline editor for license / author /
// source URL. Title is intentionally absent; the asset doc's `name` field
// (Display name above this block) is the canonical title.
const AttributionBlock = ({
  attribution,
  setAttribution,
  editing,
  onEnterEdit,
  onCancel,
  isOwner,
  disabled
}) => {
  const composed = composeAttributionString(attribution);
  const hasAnything =
    composed ||
    attribution.source ||
    attribution.sourceName ||
    attribution.generator;

  if (!editing) {
    return (
      <div className={styles.attributionGroup}>
        <div className={styles.attributionHeader}>
          <span>Attribution</span>
          {isOwner && (
            <button
              type="button"
              className={styles.attributionEditBtn}
              onClick={onEnterEdit}
              disabled={disabled}
            >
              Edit
            </button>
          )}
        </div>
        {hasAnything ? (
          <AttributionView attribution={attribution} composed={composed} />
        ) : (
          <div className={styles.attributionEmpty}>
            No attribution info.
            {isOwner && ' Click Edit to add one.'}
          </div>
        )}
      </div>
    );
  }

  const setField = (key) => (e) =>
    setAttribution((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className={styles.attributionGroup}>
      <div className={styles.attributionHeader}>
        <span>Attribution</span>
        <button
          type="button"
          className={styles.attributionEditBtn}
          onClick={onCancel}
          disabled={disabled}
        >
          Cancel
        </button>
      </div>
      <div className={styles.attributionFields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="meshAttrAuthor">
            Author
          </label>
          <input
            id="meshAttrAuthor"
            type="text"
            className={styles.fieldInput}
            value={attribution.author}
            onChange={setField('author')}
            disabled={disabled}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="meshAttrLicense">
            License
          </label>
          <input
            id="meshAttrLicense"
            type="text"
            className={styles.fieldInput}
            value={attribution.license}
            onChange={setField('license')}
            disabled={disabled}
            placeholder="e.g. CC-BY-4.0"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="meshAttrSource">
            Source URL
          </label>
          <input
            id="meshAttrSource"
            type="url"
            className={styles.fieldInput}
            value={attribution.source}
            onChange={setField('source')}
            disabled={disabled}
            placeholder="https://…"
          />
        </div>
      </div>
      {/* Read-only context — where the file came from. Surfacing this in
          the editor reminds the user what was auto-detected without making
          it look editable (it's derived from the source URL / generator). */}
      {(attribution.sourceName || attribution.generator) && (
        <div className={styles.attributionContext}>
          {attribution.sourceName && (
            <span>
              <span className={styles.metaLabel}>Source:</span>
              {attribution.sourceName}
            </span>
          )}
          {attribution.generator && (
            <span>
              <span className={styles.metaLabel}>Generator:</span>
              {attribution.generator}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

AttributionBlock.propTypes = {
  attribution: PropTypes.object.isRequired,
  setAttribution: PropTypes.func.isRequired,
  editing: PropTypes.bool.isRequired,
  onEnterEdit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  isOwner: PropTypes.bool,
  disabled: PropTypes.bool
};

// Source URLs come from user-editable input and arbitrary GLB metadata, so
// only render http(s) links — block javascript:, data:, and other schemes
// that could execute on click.
const safeHref = (url) => {
  if (typeof url !== 'string') return null;
  try {
    // No base URL: requires an absolute URL. A bare path like "/admin" or
    // "foo/bar" would otherwise resolve against window.location.origin and
    // render as a link back into our own app.
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // not a parseable absolute URL
  }
  return null;
};

const AttributionView = ({ attribution, composed }) => {
  const { source, sourceName } = attribution;
  const linkLabel = sourceName ? `View on ${sourceName}` : 'View source';
  const href = safeHref(source);
  return (
    <div className={styles.attributionView}>
      {composed && <div className={styles.attributionComposed}>{composed}</div>}
      {href && (
        <a
          className={styles.attributionLink}
          href={href}
          target="_blank"
          rel="noreferrer"
        >
          {linkLabel} →
        </a>
      )}
      {sourceName && !href && (
        <div className={styles.attributionSourceName}>{sourceName}</div>
      )}
    </div>
  );
};

AttributionView.propTypes = {
  attribution: PropTypes.object.isRequired,
  composed: PropTypes.string
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
  onPlace: PropTypes.func,
  currentIndex: PropTypes.number,
  totalItems: PropTypes.number,
  onNavigate: PropTypes.func
};

export default MeshDetailsModal;
