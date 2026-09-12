/**
 * Combine per-file upload progress into one percentage.
 *
 * addAsset() uploads the original and (for GLBs) the optimized variant in
 * parallel, and the UI shows a single bar. Reporting only the original's
 * progress meant "Uploading 100%" sat there while the optimized file was
 * still going out — so the bar is byte-weighted across every file: 100%
 * means every byte of every file has been transferred.
 *
 * @param {number[]} sizes - byte size of each file, in the order callers
 *   will index into `report(i, pct)`.
 * @param {(pct: number) => void} emit - receives the combined 0..100.
 * @returns {(index: number, pct: number) => void} per-file reporter taking
 *   that file's own 0..100.
 */
export function createAggregateProgress(sizes, emit) {
  const total = sizes.reduce((sum, n) => sum + (Number(n) || 0), 0);
  const transferred = sizes.map(() => 0);
  return (index, pct) => {
    const size = Number(sizes[index]) || 0;
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    transferred[index] = (clamped / 100) * size;
    const done = transferred.reduce((sum, n) => sum + n, 0);
    emit(total > 0 ? (done / total) * 100 : clamped);
  };
}
