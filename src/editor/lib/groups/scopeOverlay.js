// The scrim over the scene while a group is open: a dark veil over the canvas
// with a hole where the open group's box is on screen.
//
// It is DOM, not part of the 3D scene, so it never touches what is rendered,
// captured or exported, and it takes no pointer events. Where it sits in the
// page decides what it covers:
// - the canvas is a body-level element with no stacking level of its own;
// - the 3D labels (shape measurements, vertex buttons) are drawn by the CSS2D
//   renderer into a body-level layer at z-index 1 (css2d-renderer.js);
// - every editor panel, toolbar and the compass live in #inspectorContainer,
//   fixed at z-index 9.
// So a body-level fixed element at z-index 2 covers the scene and its labels
// (outside labels dim with the objects they belong to) and nothing of the
// editor's own interface.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SCRIM_Z_INDEX = '2';
const SCRIM_FILL = 'rgba(3, 8, 18, 0.45)';

/**
 * The scrim element. Created on first use; `show` places it over the canvas
 * rectangle, `hide` takes it away.
 */
export class ScopeScrim {
  constructor(doc = document) {
    this.doc = doc;
    this.root = null;
    this.path = null;
  }

  ensureMounted() {
    if (this.root?.isConnected) return;
    const root = this.doc.createElementNS(SVG_NS, 'svg');
    root.setAttribute('data-group-scope-scrim', '');
    root.setAttribute('aria-hidden', 'true');
    Object.assign(root.style, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: SCRIM_Z_INDEX,
      display: 'none'
    });
    const path = this.doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', SCRIM_FILL);
    path.setAttribute('fill-rule', 'evenodd');
    root.appendChild(path);
    this.doc.body.appendChild(root);
    this.root = root;
    this.path = path;
  }

  /**
   * Cover the canvas at `rect` (client pixels), leaving `outline` (points in
   * canvas pixels, in order) uncovered. With no outline the whole canvas is
   * covered.
   */
  show(rect, outline) {
    this.ensureMounted();
    const { width, height } = rect;
    Object.assign(this.root.style, {
      display: 'block',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: width + 'px',
      height: height + 'px'
    });
    this.root.setAttribute('viewBox', `0 0 ${width} ${height}`);
    let d = `M 0 0 H ${width} V ${height} H 0 Z`;
    if (outline?.length >= 3) {
      d += ' M ' + outline.map((p) => `${p.x} ${p.y}`).join(' L ') + ' Z';
    }
    this.path.setAttribute('d', d);
  }

  hide() {
    if (this.root) this.root.style.display = 'none';
  }

  get shown() {
    return !!this.root?.isConnected && this.root.style.display !== 'none';
  }

  dispose() {
    this.root?.remove();
    this.root = null;
    this.path = null;
  }
}
