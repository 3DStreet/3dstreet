/**
 * AssetDeepLinkModal — opens a single asset's detail view from a URL hash, e.g.
 * a "your splat is ready" email linking to:
 *
 *   https://3dstreet.app/#asset:OWNER_UID/ASSET_ID
 *
 * The `asset:OWNER/ID` shape matches the asset-reference token from issue #1641,
 * so the deep link and the in-JSON reference use one syntax. The owner uid is
 * required (not just the asset id) because assets live at
 * users/{ownerUid}/assets/{assetId} and there's no way to locate one from the id
 * alone — same reason saved scenes embed data-asset-owner-uid.
 *
 * MeshDetailsModal does all the real work (self-fetches by assetId+ownerUid,
 * renders the splat/mesh viewer, degrades to read-only for non-owners). Assets
 * are public-read by default, so the asset renders even before auth resolves;
 * auth only upgrades the modal to owner mode. This is a standalone portal, so it
 * works regardless of whether the Assets panel is open. View-only here: no
 * "Place in scene" CTA (onPlace omitted) for v1.
 */

import { useState, useEffect, useCallback } from 'react';
import MeshDetailsModal from '@shared/assets/components/MeshDetailsModal.jsx';

// #asset:OWNER/ID — OWNER has no slash; ID is the remainder (also slash-free in
// practice, but `.+` keeps us robust to any future id shape).
const ASSET_HASH_RE = /^#asset:([^/]+)\/(.+)$/;

function parseAssetHash() {
  const match = (window.location.hash || '').match(ASSET_HASH_RE);
  if (!match) return null;
  const ownerUid = decodeURIComponent(match[1]);
  const assetId = decodeURIComponent(match[2]);
  if (!ownerUid || !assetId) return null;
  return { ownerUid, assetId };
}

export default function AssetDeepLinkModal() {
  const [target, setTarget] = useState(parseAssetHash);

  useEffect(() => {
    const onHashChange = () => setTarget(parseAssetHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleClose = useCallback(() => {
    setTarget(null);
    // Strip the asset hash so a reload / back-button doesn't reopen the modal,
    // without leaving a bare '#'. replaceState doesn't fire hashchange, so this
    // won't loop back through our listener.
    if (ASSET_HASH_RE.test(window.location.hash || '')) {
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
  }, []);

  if (!target) return null;

  return (
    <MeshDetailsModal
      assetId={target.assetId}
      ownerUid={target.ownerUid}
      onClose={handleClose}
    />
  );
}
