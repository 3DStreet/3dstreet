/* global AFRAME */

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

    // Get all segments
    const segments = Array.from(this.el.querySelectorAll('[street-segment]'));
    if (segments.length === 0) return;

    // Calculate total width
    const totalWidth = segments.reduce((sum, segment) => {
      return sum + (segment.getAttribute('street-segment')?.width || 0);
    }, 0);
    console.log('total width', totalWidth);

    // Get street length from managed-street component
    const streetLength = this.el.getAttribute('managed-street')?.length || 0;

    // Calculate starting positions
    let xPosition = 0;
    if (data.width === 'center') {
      xPosition = -totalWidth / 2;
    } else if (data.width === 'right') {
      xPosition = -totalWidth;
    }

    let zPosition = 0;
    if (data.length === 'start') {
      zPosition = -streetLength / 2;
    } else if (data.length === 'end') {
      zPosition = streetLength / 2;
    }

    // Position segments
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
  },

  remove: function () {
    // Clean up event listener
    this.el.removeEventListener('segments-changed', this.realignStreet);
  }
});
