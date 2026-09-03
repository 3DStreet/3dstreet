// A single on-canvas readout chip (CSS2D billboard) that follows a THREE
// object — used by the street endpoint gizmo to show the dragged endpoint's
// scene coordinates, and its lat/lon + street bearing when the geo layer is
// live. Same look as the shape length chips (`.shape-readout*` styles), and
// like ShapeReadouts it owns its DOM and detaches everything in dispose().

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { READOUT_RENDER_ORDER } from '../shapeEditRules';

export default class GeoReadout {
  constructor(parent) {
    const outer = document.createElement('div');
    outer.className = 'shape-readout';
    outer.style.pointerEvents = 'none';
    const inner = document.createElement('div');
    inner.className = 'label shape-readout-label';
    inner.style.color = '#fff';
    inner.style.fontFamily = 'sans-serif';
    inner.style.fontSize = '12px';
    inner.style.padding = '2px 6px';
    inner.style.borderRadius = '3px';
    inner.style.whiteSpace = 'pre';
    inner.style.textAlign = 'center';
    inner.style.pointerEvents = 'none';
    outer.appendChild(inner);
    this.inner = inner;
    this.obj = new CSS2DObject(outer);
    this.obj.renderOrder = READOUT_RENDER_ORDER.caption;
    // Sit above the handle disc so the chip doesn't cover the knob.
    this.obj.position.set(0, 2.5, 0);
    this.parent = parent;
    parent.add(this.obj);
  }

  setText(text) {
    this.inner.textContent = text;
  }

  dispose() {
    if (this.obj.parent) this.obj.parent.remove(this.obj);
    this.obj.element?.remove();
    this.parent = null;
  }
}
