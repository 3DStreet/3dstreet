/* global AFRAME */
const {
  getTravelledWaySegments,
  getBoundarySegments
} = require('./street-layout-utils');

AFRAME.registerComponent('street-align', {
  dependencies: ['managed-street'],
  schema: {
    width: {
      default: 'center',
      type: 'string',
      oneOf: ['center', 'left', 'right']
    },
    length: {
      default: 'start',
      type: 'string',
      oneOf: ['middle', 'start', 'end']
    }
  },

  init: function () {
    // Listen for any segment changes from managed-street
    this.realignStreet = this.realignStreet.bind(this);
    this.el.addEventListener('segments-changed', this.realignStreet);

    // wait for all components, including managed-street to be initialized
    setTimeout(() => {
      this.realignStreet();
    }, 0);
  },

  update: function (oldData) {
    const data = this.data;
    const diff = AFRAME.utils.diff(oldData, data);

    // Only realign if width or length alignment changed
    if (diff.width !== undefined || diff.length !== undefined) {
      this.el.emit('alignment-changed', {
        changeType: 'alignment',
        oldData: oldData,
        newData: data
      });
      this.realignStreet();
    }
  },

  realignStreet: function () {
    const data = this.data;

    // Alignment is computed from the travelled way alone. Boundaries (adjacent
    // land use at the street edges) are positioned afterwards, derived from
    // the travelled way's outer edges — they never shift the street, whether
    // present, hidden, or shown (see street-layout-utils.js).
    const segments = getTravelledWaySegments(this.el);
    if (segments.length === 0) return;

    // Calculate travelled way width
    const totalWidth = segments.reduce((sum, segment) => {
      return sum + (segment.getAttribute('street-segment')?.width || 0);
    }, 0);

    // Get street length from managed-street component
    const streetLength = this.el.getAttribute('managed-street')?.length || 0;

    // Calculate starting positions
    let xPosition = 0;
    if (data.width === 'center') {
      xPosition = -totalWidth / 2;
    } else if (data.width === 'right') {
      xPosition = -totalWidth;
    }
    const leftEdge = xPosition;
    const rightEdge = xPosition + totalWidth;

    let zPosition = 0;
    if (data.length === 'start') {
      zPosition = -streetLength / 2;
    } else if (data.length === 'end') {
      zPosition = streetLength / 2;
    }

    // Position travelled-way segments sequentially
    segments.forEach((segment) => {
      const width = segment.getAttribute('street-segment')?.width;
      const currentPos = segment.getAttribute('position');

      xPosition += width / 2;

      segment.setAttribute('position', {
        x: xPosition,
        y: currentPos.y,
        z: zPosition
      });

      xPosition += width / 2;
    });

    // Position boundaries outward from the travelled way's edges by their
    // `side`, stacking multiples further out in DOM order. Hidden boundaries
    // are positioned too, so toggling them visible never moves anything.
    const boundaries = getBoundarySegments(this.el);
    let leftOffset = 0;
    boundaries.left.forEach((segment) => {
      const width = segment.getAttribute('street-segment')?.width || 0;
      const currentPos = segment.getAttribute('position');
      leftOffset += width;
      segment.setAttribute('position', {
        x: leftEdge - leftOffset + width / 2,
        y: currentPos.y,
        z: zPosition
      });
    });
    let rightOffset = 0;
    boundaries.right.forEach((segment) => {
      const width = segment.getAttribute('street-segment')?.width || 0;
      const currentPos = segment.getAttribute('position');
      segment.setAttribute('position', {
        x: rightEdge + rightOffset + width / 2,
        y: currentPos.y,
        z: zPosition
      });
      rightOffset += width;
    });
  },

  remove: function () {
    // Clean up event listener
    this.el.removeEventListener('segments-changed', this.realignStreet);
  }
});
