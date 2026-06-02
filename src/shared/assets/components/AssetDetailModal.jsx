/**
 * AssetDetailModal — the single place that decides "which detail modal for which
 * asset type", and the only component any entry point should render.
 *
 * Mesh + splat → the interactive 3D viewer (MeshDetailsModal); image + video →
 * AssetsModal. That split (is3dViewerType) lives in exactly one spot now —
 * previously the gallery, the editor sidebar "Details" button, and the email
 * deep link each re-decided it, and two of them forgot `splat`, shipping the
 * wrong modal.
 *
 * It also absorbs the two modals' different contracts: MeshDetailsModal
 * self-fetches by assetId + ownerUid, while AssetsModal needs a hydrated display
 * `item`. Callers can pass whatever they have:
 *   - a display `item` (gallery already has one) — used directly,
 *   - identity + type (`assetId`, `ownerUid`, `type`) — routed immediately,
 *   - bare identity (`assetId`, `ownerUid`) — e.g. a deep link: we fetch the doc
 *     to learn the type, then route.
 *
 * Irrelevant handlers are harmless: MeshDetailsModal ignores onUseForGenerator /
 * onUseForVideo / onDownload / onDelete; AssetsModal ignores onPlace. So callers
 * can pass the union and each modal takes what it needs.
 */

import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import AssetsModal from './AssetsModal.jsx';
import MeshDetailsModal from './MeshDetailsModal.jsx';
import assetsService from '../services/assetsService.js';
import { assetToDisplayItem } from '../hooks/useAssets.js';
import { is3dViewerType } from '../utils.js';

const AssetDetailModal = ({
  item,
  assetId,
  ownerUid,
  type,
  onClose,
  onPlace,
  onNavigate,
  currentIndex,
  totalItems,
  onDownload,
  onDelete,
  onUseForGenerator,
  onUseForVideo
}) => {
  const resolvedAssetId = assetId ?? item?.id ?? null;
  const resolvedOwnerUid = ownerUid ?? item?.userId ?? null;
  const knownType = type ?? item?.type ?? null;

  // We fetch the doc ourselves when we're headed for AssetsModal (image/video,
  // or a bare deep link whose type we don't know yet) without a hydrated item.
  // MeshDetailsModal self-fetches, so a known mesh/splat needs no fetch here.
  const needDocFetch =
    !item &&
    !!resolvedAssetId &&
    !!resolvedOwnerUid &&
    !is3dViewerType(knownType);
  const [fetchedDoc, setFetchedDoc] = useState(null);
  useEffect(() => {
    if (!needDocFetch) return;
    let cancelled = false;
    assetsService
      .getAsset(resolvedAssetId, resolvedOwnerUid)
      .then((doc) => {
        if (!cancelled && doc) {
          setFetchedDoc({ ...doc, assetId: resolvedAssetId });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needDocFetch, resolvedAssetId, resolvedOwnerUid]);

  const effectiveType = knownType ?? fetchedDoc?.type ?? null;

  // Still fetching (to learn the type and/or hydrate the item) — render nothing
  // briefly; the chrome behind us is already there and the chosen modal shows
  // its own loading state once it mounts.
  if (needDocFetch && !fetchedDoc) return null;

  if (is3dViewerType(effectiveType)) {
    // MeshDetailsModal self-fetches; identity is all it needs.
    return (
      <MeshDetailsModal
        assetId={resolvedAssetId}
        ownerUid={resolvedOwnerUid}
        onClose={onClose}
        onPlace={onPlace}
        onNavigate={onNavigate}
        currentIndex={currentIndex}
        totalItems={totalItems}
      />
    );
  }

  // image / video → AssetsModal, which needs a hydrated display item. Prefer the
  // one the caller passed; otherwise derive it from the doc we fetched to learn
  // the type.
  const displayItem =
    item ?? (fetchedDoc ? assetToDisplayItem(fetchedDoc) : null);
  if (!displayItem) return null;

  return (
    <AssetsModal
      item={displayItem}
      onClose={onClose}
      onNavigate={onNavigate}
      currentIndex={currentIndex}
      totalItems={totalItems}
      onDownload={onDownload}
      onDelete={onDelete}
      onUseForGenerator={onUseForGenerator}
      onUseForVideo={onUseForVideo}
    />
  );
};

AssetDetailModal.propTypes = {
  // Supply a hydrated display item, OR identity (assetId + ownerUid [+ type]).
  item: PropTypes.object,
  assetId: PropTypes.string,
  ownerUid: PropTypes.string,
  type: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  // 3D-viewer (mesh/splat) only:
  onPlace: PropTypes.func,
  // Both modals:
  onNavigate: PropTypes.func,
  currentIndex: PropTypes.number,
  totalItems: PropTypes.number,
  // AssetsModal (image/video) only:
  onDownload: PropTypes.func,
  onDelete: PropTypes.func,
  onUseForGenerator: PropTypes.func,
  onUseForVideo: PropTypes.func
};

export default AssetDetailModal;
