/**
 * Cell size for the 2×2 4x-render grid.
 *
 * Cells take the source screenshot's aspect ratio when the container has
 * room for it, so a wide screenshot isn't cropped to a square. When there
 * isn't enough width (the cells would come out less than MIN_HEIGHT_RATIO as
 * tall as square cells), the grid falls back to square cells, which crop the
 * sides.
 */

export const RENDER_GRID_GAP = 12; // matches .renderGrid gap
const GAP = RENDER_GRID_GAP;
const MIN_HEIGHT_RATIO = 0.75;
const MAX_SQUARE_CELL = 294; // (600px max grid - gap) / 2, the stylesheet cap

/**
 * @param {Object} args
 * @param {number} args.width - Available container width (px)
 * @param {number} args.height - Available container height (px)
 * @param {number|null} args.aspect - Source image width / height
 * @returns {{ width: number, height: number } | null} Cell size, or null
 *   while sizes are unknown (the stylesheet's default layout applies).
 */
export function computeRenderGridCell({ width, height, aspect }) {
  if (!width || !height || !aspect || !Number.isFinite(aspect)) return null;

  const maxCellW = (width - GAP) / 2;
  const maxCellH = (height - GAP) / 2;
  if (maxCellW <= 0 || maxCellH <= 0) return null;

  const square = Math.min(maxCellW, maxCellH, MAX_SQUARE_CELL);

  // Largest cell with the source's aspect ratio that fits both ways.
  const cellW = Math.min(maxCellW, maxCellH * aspect);
  const cellH = cellW / aspect;

  if (aspect <= 1 || cellH < square * MIN_HEIGHT_RATIO) {
    const side = Math.floor(square);
    return { width: side, height: side };
  }
  return { width: Math.floor(cellW), height: Math.floor(cellH) };
}
