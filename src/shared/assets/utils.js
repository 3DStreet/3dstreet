/**
 * Formatters shared by the Assets panel storage meter and the mesh details
 * modal. Sizes use decimal MB/GB (base 1000) to match how plan limits are
 * displayed elsewhere in the app.
 */

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

/**
 * Human label for an asset's origin. For meshes this is the user-editable
 * display name; for uploads it's "Upload"; for AI renders it's the model
 * (e.g. "flux"). Falls back to "Unknown" so callers never render `undefined`.
 */
export function getAssetSourceLabel(item) {
  if (!item) return 'Unknown';
  if (item.type === 'mesh') {
    return item.name || item.originalFilename || 'Untitled';
  }
  if (item.category === 'upload') return 'Upload';
  return item.metadata?.model || 'Unknown';
}

/**
 * Type label for an asset card / modal header (`Image`, `Video`, `Model`).
 */
export function getAssetTypeLabel(item) {
  if (!item) return 'Asset';
  if (item.type === 'video') return 'Video';
  if (item.type === 'mesh') return 'Model';
  if (item.type === 'splat') return 'Splat';
  return 'Image';
}

/**
 * Canonical "{Type} · {Source}" title used by the gallery card overlay and
 * every asset detail modal. Keeping these in lockstep avoids the gallery
 * saying "Image · Upload" while the modal shows "Image - Unknown Model".
 */
export function getAssetTitle(item) {
  return `${getAssetTypeLabel(item)} · ${getAssetSourceLabel(item)}`;
}

/**
 * URL to use when loading or placing a GLB asset. Prefers the client-optimized
 * version (Draco + WebP) when available; falls back to the original source.
 * Safe to call on image/video assets too — they never have optimizedSourceUrl
 * so storageUrl is always returned.
 */
export function getServedUrl(item) {
  return item?.optimizedSourceUrl ?? item?.storageUrl;
}

/**
 * Derives optimization display info from a GLB asset doc.
 *
 * Returns one of three shapes:
 *   { origSize }                          — no optimization metadata (image/video, or pre-opt upload)
 *   { origSize, skipReason }              — optimization ran but was skipped
 *   { origSize, optSize, savePct }        — optimization succeeded and saved bytes
 */
export function getOptimizationDisplay(data) {
  const meta = data?.optimizationMetadata;
  const origSize = Number(data?.size) || 0;
  if (!meta) return { origSize };

  if (meta.optimizationSkipped) {
    const skipReason =
      meta.reason === 'already_optimized'
        ? 'Already optimized'
        : meta.reason === 'not_smaller'
          ? "Optimization didn't reduce size"
          : 'Optimization skipped';
    return { origSize, skipReason };
  }

  const optSize = Number(data?.optimizedSourceSize) || 0;
  if (optSize > 0 && optSize < origSize) {
    const savePct = Math.round((1 - optSize / origSize) * 100);
    return { origSize, optSize, savePct };
  }

  return { origSize };
}

/**
 * Format a timestamp value as a locale string. Accepts Firestore Timestamp
 * objects (`.toDate()`), Date instances, and ISO / millisecond inputs that
 * `new Date()` understands. Returns '' on falsy or invalid input.
 */
export function formatDate(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString();
  } catch {
    return '';
  }
}
