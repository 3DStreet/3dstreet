import { getTravelledWaySegments } from './street-layout-utils';
import { getRibbonGeometryAttr } from './street-path.js';

AFRAME.registerComponent('street-ground', {
  dependencies: ['managed-street', 'street-align'],

  init: function () {
    this.createOrUpdateDirtbox = this.createOrUpdateDirtbox.bind(this);

    // Listen for any changes from managed-street
    this.el.addEventListener('segments-changed', this.createOrUpdateDirtbox);

    // Listen for alignment changes
    this.el.addEventListener('alignment-changed', this.createOrUpdateDirtbox);

    // Re-shape the slab when the street's path curve is (re)built or cleared
    this.el.addEventListener(
      'street-curve-changed',
      this.createOrUpdateDirtbox
    );

    // Create initial dirtbox
    setTimeout(() => {
      this.createOrUpdateDirtbox();
    }, 0);
  },

  createOrUpdateDirtbox: function () {
    // Find or create dirtbox element
    if (!this.dirtbox) {
      this.dirtbox = this.el.querySelector('.dirtbox');
    }
    if (!this.dirtbox) {
      this.dirtbox = document.createElement('a-box');
      this.dirtbox.classList.add('autocreated');
      this.dirtbox.classList.add('.dirtbox');
      this.el.append(this.dirtbox);

      this.dirtbox.setAttribute(
        'material',
        `color: ${window.STREET.colors.brown};`
      );
      this.dirtbox.setAttribute('data-layer-name', 'Underground');
      this.dirtbox.setAttribute('data-no-transform', '');
      this.dirtbox.setAttribute('data-ignore-raycaster', '');
      this.dirtbox.setAttribute('polygon-offset', {
        factor: 4,
        units: 4
      });
    }

    // The ground slab spans the travelled way only — boundaries render their
    // own surface boxes and never affect street layout (street-layout-utils).
    const segments = getTravelledWaySegments(this.el);
    if (segments.length === 0) return;

    const totalWidth = segments.reduce((sum, segment) => {
      return sum + (segment.getAttribute('street-segment')?.width || 0);
    }, 0);
    const streetLength = this.el.getAttribute('managed-street')?.length || 0;

    // Get alignment from street-align component
    const streetAlign = this.el.components['street-align'];
    const alignWidth = streetAlign?.data.width || 'center';
    const alignLength = streetAlign?.data.length || 'start';

    // Calculate position based on alignment
    let xPosition = 0;
    if (alignWidth === 'center') {
      xPosition = 0;
    } else if (alignWidth === 'left') {
      xPosition = totalWidth / 2;
    } else if (alignWidth === 'right') {
      xPosition = -totalWidth / 2;
    }

    let zPosition = 0;
    if (alignLength === 'start') {
      zPosition = -streetLength / 2;
    } else if (alignLength === 'end') {
      zPosition = streetLength / 2;
    }

    // Curved street: the slab is a full-width ribbon along the path (top at
    // y=0, 2m deep, same end inset as the straight box; a closed loop runs
    // the full circumference with no caps). Straight: the classic box.
    const curve = this.el.components['managed-street']?.streetCurve;
    const ribbonAttr =
      curve &&
      getRibbonGeometryAttr(this.el, {
        origin: { x: 0, z: 0 },
        lateralOffset: xPosition,
        width: totalWidth,
        height: 2,
        sStart: curve.closed ? 0 : 0.1,
        sEnd: curve.closed ? streetLength : streetLength - 0.1
      });
    // setAttribute merges into existing geometry data, so clear the attribute
    // when the primitive flips (box ↔ street-ribbon) to avoid stale keys
    const targetPrimitive = ribbonAttr ? 'street-ribbon' : 'box';
    if (this.dirtbox.getAttribute('geometry')?.primitive !== targetPrimitive) {
      this.dirtbox.removeAttribute('geometry');
    }
    if (ribbonAttr) {
      this.dirtbox.setAttribute('geometry', ribbonAttr);
      this.dirtbox.setAttribute('position', '0 0 0');
    } else {
      this.dirtbox.setAttribute('geometry', {
        primitive: 'box',
        width: totalWidth,
        height: 2,
        depth: streetLength - 0.2
      });
      this.dirtbox.setAttribute('position', `${xPosition} -1 ${zPosition}`);
    }

    // honor the managed-street showGround toggle (managed-street emits
    // segments-changed when it flips, which re-runs this method)
    this.dirtbox.setAttribute(
      'visible',
      this.el.getAttribute('managed-street')?.showGround !== false
    );
  },

  remove: function () {
    // Clean up
    if (this.dirtbox) {
      this.dirtbox.remove();
    }
    this.el.removeEventListener('segments-changed', this.createOrUpdateDirtbox);
    this.el.removeEventListener(
      'alignment-changed',
      this.createOrUpdateDirtbox
    );
    this.el.removeEventListener(
      'street-curve-changed',
      this.createOrUpdateDirtbox
    );
  }
});
