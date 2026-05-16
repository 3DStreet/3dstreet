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
