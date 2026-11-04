/**
 * AssetPickerModal — pick one asset of a given type from the user's library
 * (#2142).
 *
 * The inverse of the gallery: instead of starting from an asset and choosing
 * what to do with it, the caller starts from a slot that needs an asset (a
 * scene entity whose cloud asset is missing or not owned, a generator source
 * image) and asks the user to fill it. The grid shows only assets of the
 * requested `type`; a click selects (and can be changed freely), and nothing
 * happens until the confirm button is pressed. Cancel, Escape and a backdrop
 * click all close without side effects.
 *
 * Shared and scene-free: the caller decides what "confirm" does with the
 * chosen display item (see useAssets.assetToDisplayItem for its shape).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import PropTypes from 'prop-types';
import useAssets from '../hooks/useAssets.js';
import { ASSET_TYPES } from '../constants.js';
import { getServedUrl } from '../utils.js';
import { MeshPlaceholder, SplatPlaceholder } from './AssetsItem.jsx';
import { useSharedMessages } from '../../i18n/sharedMessages';
import styles from './AssetPickerModal.module.scss';

// Empty-state copy per type, reusing the Assets panel's filter-tab strings.
const EMPTY_MESSAGE_BY_TYPE = {
  [ASSET_TYPES.MESH]: 'noMeshAssetsYet',
  [ASSET_TYPES.SPLAT]: 'noSplatAssetsYet',
  [ASSET_TYPES.IMAGE]: 'noImageAssetsYet',
  [ASSET_TYPES.VIDEO]: 'noVideoAssetsYet'
};

const PickerThumb = ({ item }) => {
  if (item.thumbnailUrl) {
    return <img src={item.thumbnailUrl} alt="" loading="lazy" />;
  }
  if (item.type === ASSET_TYPES.MESH) return <MeshPlaceholder />;
  if (item.type === ASSET_TYPES.SPLAT) return <SplatPlaceholder />;
  if (item.type === ASSET_TYPES.VIDEO) {
    return <video src={item.objectURL} muted preload="metadata" />;
  }
  return <img src={item.objectURL} alt="" loading="lazy" />;
};

PickerThumb.propTypes = { item: PropTypes.object.isRequired };

const AssetPickerModal = ({
  type,
  title,
  confirmLabel,
  excludeAssetId,
  onConfirm,
  onCancel,
  onSignIn
}) => {
  const t = useSharedMessages();
  const { items, isLoading, isLoggedIn, hasMore, isLoadingMore, loadMore } =
    useAssets();
  const [selectedId, setSelectedId] = useState(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const sentinelRef = useRef(null);

  // Only assets that can actually fill the slot: same type, servable, and not
  // the asset being replaced.
  const candidates = useMemo(
    () =>
      items.filter(
        (item) =>
          item.type === type &&
          item.id !== excludeAssetId &&
          !!getServedUrl(item)
      ),
    [items, type, excludeAssetId]
  );
  const selectedItem = candidates.find((i) => i.id === selectedId) || null;

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    // Capture so the editor's own Escape shortcut (deselect) doesn't fire too.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  // The library is paged across all types and filtered here, so keep loading
  // pages while the sentinel is visible — a type that is rare in the library
  // would otherwise look empty after the first page.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !isLoadingMore) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, loadMore, candidates.length]);

  const handleConfirm = async (item = selectedItem) => {
    if (!item || isConfirming) return;
    setIsConfirming(true);
    try {
      await onConfirm(item);
    } finally {
      setIsConfirming(false);
    }
  };

  let body;
  if (!isLoggedIn) {
    body = (
      <div className={styles.message}>
        <p>{t('signInToViewAssets')}</p>
        {onSignIn && (
          <button type="button" className={styles.primary} onClick={onSignIn}>
            {t('signIn')}
          </button>
        )}
      </div>
    );
  } else if (isLoading) {
    body = <div className={styles.message}>{t('loadingGallery')}</div>;
  } else if (candidates.length === 0 && !hasMore) {
    body = (
      <div className={styles.message}>
        {t(EMPTY_MESSAGE_BY_TYPE[type] || 'noAssetsYet')}
      </div>
    );
  } else {
    body = (
      <>
        <div className={styles.grid} role="listbox" aria-label={title}>
          {candidates.map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                type="button"
                key={item.id}
                role="option"
                aria-selected={selected}
                className={`${styles.card} ${selected ? styles.selected : ''}`}
                onClick={() => setSelectedId(item.id)}
                onDoubleClick={() => handleConfirm(item)}
                title={item.name || item.originalFilename || ''}
              >
                <span className={styles.thumb}>
                  <PickerThumb item={item} />
                </span>
                <span className={styles.name}>
                  {item.name || item.originalFilename || item.id}
                </span>
              </button>
            );
          })}
        </div>
        {hasMore && (
          <div ref={sentinelRef} className={styles.message}>
            {isLoadingMore ? t('loadingGallery') : null}
          </div>
        )}
      </>
    );
  }

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onCancel}
            aria-label={t('cancel')}
          >
            ×
          </button>
        </div>
        <div className={styles.body}>{body}</div>
        <div className={styles.footer}>
          <span className={styles.selection}>
            {selectedItem
              ? selectedItem.name || selectedItem.originalFilename || ''
              : t('assetPickerSelectHint')}
          </span>
          <button type="button" className={styles.secondary} onClick={onCancel}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => handleConfirm()}
            disabled={!selectedItem || isConfirming}
          >
            {confirmLabel || t('replace')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

AssetPickerModal.propTypes = {
  // One of ASSET_TYPES: only assets of this type are offered.
  type: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  // Defaults to "Replace".
  confirmLabel: PropTypes.string,
  // The asset being replaced, hidden from the list.
  excludeAssetId: PropTypes.string,
  // Receives the chosen display item; may return a promise (button stays
  // disabled until it settles). The caller closes the modal.
  onConfirm: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  onSignIn: PropTypes.func
};

export default AssetPickerModal;
