/**
 * Scale factor (≤ 1) that fits a width × height image within maxMegapixels.
 * Returns 1 when there is no cap or the image already fits.
 * @param {number} width
 * @param {number} height
 * @param {number|null|undefined} maxMegapixels
 * @returns {number}
 */
export const fitScale = (width, height, maxMegapixels) => {
  if (!maxMegapixels || !width || !height) return 1;
  const pixels = width * height;
  const maxPixels = maxMegapixels * 1e6;
  return pixels > maxPixels ? Math.sqrt(maxPixels / pixels) : 1;
};
