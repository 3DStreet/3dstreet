/**
 * Transparent-pass layering around Gaussian splats (#1732, #1754).
 *
 * three.js draws every opaque object first, then the transparent queue sorted
 * by `renderOrder` and, within one renderOrder, by the camera distance of each
 * object's ORIGIN (farthest first). Spark draws every splat in the scene as ONE
 * transparent mesh (the SparkRenderer, added at the scene root, so its origin
 * is the scene origin) that tests depth but never writes it. Left at the
 * default renderOrder 0, where the splats land among the scene's other
 * transparent surfaces depends on how far the camera happens to be from the
 * scene origin versus from each surface's own origin, and each outcome fails
 * differently:
 *
 * - A surface drawn AFTER the splats composites over them, whatever its depth.
 * - A surface drawn BEFORE the splats occludes them only where it wrote depth.
 *   Where it didn't (glTF BLEND materials: GLTFLoader turns depth writes off)
 *   the splats paint straight over it (#1732).
 * - A translucent surface that writes depth and draws before the splats hides
 *   them outright, its opacity notwithstanding (30% 3D Tiles, #1754).
 *
 * The layering used instead:
 *
 * 1. Ordinary transparent scene content stays at renderOrder 0 and draws first
 *    in the transparent pass, so anything that writes depth (lane markings
 *    with an alpha test, the ocean, an entity with `material.opacity`, glTF
 *    cutouts once `applyBlendedSurfaceDepth` has run) occludes the splats per
 *    pixel exactly like opaque geometry does.
 * 2. Splats draw next (SPLAT_RENDER_ORDER): after every ordinary surface, but
 *    before the annotation-style overlays that already sit at 1 and above
 *    (model placeholders, shape fills, editor gizmos), which keep compositing
 *    over the splats.
 * 3. Reference map layers at partial opacity (Google 3D Tiles, the 2D
 *    basemap, OSM buildings) are overlays too: at REFERENCE_OVERLAY_RENDER_ORDER
 *    they blend over the splats at their opacity and can never hide them. At
 *    opacity 1 they are opaque and leave the transparent queue altogether.
 *
 * Both values are fractions so they slot between ordinary content (0) and the
 * overlay band that starts at 1 (`FILL_ORDER_BASE` in shapeFillRender.js and
 * the model-placeholder mesh) without moving anything already there.
 */
export const SPLAT_RENDER_ORDER = 0.25;
export const REFERENCE_OVERLAY_RENDER_ORDER = 0.5;

/**
 * renderOrder for a reference map layer mesh drawn at `opacity`: the overlay
 * slot while translucent, the default while opaque.
 */
export function referenceLayerRenderOrder(opacity) {
  return opacity < 1 ? REFERENCE_OVERLAY_RENDER_ORDER : 0;
}

/**
 * Set a reference map layer's opacity on every material under `object` and
 * slot each mesh as an overlay while translucent. Tiles keep their stock
 * materials: no extra draw cost at opacity 1 and standard alpha blending
 * below it. Depth writes stay on so a translucent layer still occludes
 * itself (only the nearest tile surface shows through, not every layer
 * behind it).
 */
export function applyReferenceLayerOpacity(object, opacity) {
  const transparent = opacity < 1;
  const renderOrder = referenceLayerRenderOrder(opacity);
  object.traverse((obj) => {
    if (!obj.material) return;
    obj.renderOrder = renderOrder;
    const materials = Array.isArray(obj.material)
      ? obj.material
      : [obj.material];
    for (const material of materials) {
      if (material.transparent !== transparent) {
        material.transparent = transparent;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
    }
  });
}

/**
 * A blended glTF material at least this opaque is treated as a surface that
 * writes depth. Below it (tinted glass, ghosted parts) the loader's
 * no-depth-write default stands, since a depth write from a mostly clear
 * pane would punch a hole through everything transparent behind it.
 */
export const SURFACE_OPACITY_MIN = 0.5;
/**
 * Alpha test applied alongside the depth write so a cutout's clear texels
 * (the empty area of a foliage card) are discarded instead of writing depth
 * over whatever lies behind the card. Low enough to keep soft edges blending.
 */
export const CUTOUT_ALPHA_TEST = 0.1;

/**
 * glTF BLEND materials arrive with depth writes off (three's GLTFLoader,
 * mrdoob/three.js#17706), which is right for glass but wrong for the cutouts
 * (foliage, fences, signage) that many assets export as BLEND instead of MASK:
 * with nothing in the depth buffer, splats drawn after them paint straight
 * over them (#1732). Returns true when the material was changed.
 */
export function applyBlendedSurfaceDepth(material) {
  if (!material || !material.transparent || material.depthWrite) return false;
  if (!(material.opacity >= SURFACE_OPACITY_MIN)) return false;
  material.depthWrite = true;
  if (!(material.alphaTest > 0)) material.alphaTest = CUTOUT_ALPHA_TEST;
  material.needsUpdate = true;
  return true;
}

/** Run `applyBlendedSurfaceDepth` over every material under `object`. */
export function applyBlendedSurfaceDepthToObject(object) {
  object.traverse((node) => {
    if (!node.material) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    for (const material of materials) applyBlendedSurfaceDepth(material);
  });
}
