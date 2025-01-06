/* global AFRAME */

AFRAME.registerComponent('street-align', {
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
    this.monitoredSegments = [];

    this.boundWidthChangedHandler = this.onSegmentWidthChanged.bind(this);

    // Initial setup
    this.refreshMonitoredSegments(); // This now handles initial segment listeners
    this.setupMutationObserver();
    this.realignStreet();

    // for when loading from saved scene, add set timeout to refresh the segments and realign
    setTimeout(() => {
      this.refreshMonitoredSegments();
      this.realignStreet();
    }, 2000);
  },

  setupSegmentListeners: function () {
    // Set up listeners for all existing segments
    const segments = this.el.querySelectorAll('[street-segment]');
    segments.forEach((segment) => this.addSegmentListener(segment));
  },

  addSegmentListener: function (segment) {
    // Listen for width changes
    segment.addEventListener(
      'segment-width-changed',
      this.boundWidthChangedHandler
    );
  },

  removeSegmentListener: function (segment) {
    // Remove listeners
    segment.removeEventListener(
      'segment-width-changed',
      this.boundWidthChangedHandler
    );
    const index = this.monitoredSegments.indexOf(segment);
    if (index > -1) {
      this.monitoredSegments.splice(index, 1);
    }
  },

  onSegmentWidthChanged: function (event) {
    console.log('segment width changed handler called', event);
    this.refreshMonitoredSegments();
    this.realignStreet();
  },

  refreshMonitoredSegments: function () {
    // Clear existing listeners
    this.monitoredSegments.forEach((segment) => {
      this.removeSegmentListener(segment);
    });

    // Reset the list
    this.monitoredSegments = [];

    // Reset and repopulate the list
    this.monitoredSegments = Array.from(
      this.el.querySelectorAll('[street-segment]')
    );

    // Add new listeners
    const segments = this.el.querySelectorAll('[street-segment]');
    segments.forEach((segment) => {
      this.addSegmentListener(segment);
    });
    console.log('monitored segments', this.monitoredSegments);
  },

  update: function (oldData) {
    const data = this.data;
    const diff = AFRAME.utils.diff(oldData, data);

    // Only realign if width or length alignment changed
    if (diff.width !== undefined || diff.length !== undefined) {
      // this.alignStreetSegments();
      this.realignStreet();
    }
  },

  setupMutationObserver: function () {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver((mutations) => {
      let needsReflow = false;

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          // Instead of handling segments individually, refresh the entire list
          if (
            Array.from(mutation.addedNodes).some(
              (node) => node.hasAttribute && node.hasAttribute('street-segment')
            ) ||
            Array.from(mutation.removedNodes).some(
              (node) => node.hasAttribute && node.hasAttribute('street-segment')
            )
          ) {
            needsReflow = true;
          }
        }
      });

      if (needsReflow) {
        this.refreshMonitoredSegments();
        this.realignStreet();
      }
    });

    this.observer.observe(this.el, {
      childList: true,
      subtree: false
    });
  },

  realignStreet: function () {
    const data = this.data;
    if (this.monitoredSegments.length === 0) return;

    // Calculate total width
    const totalWidth = this.monitoredSegments.reduce((sum, segment) => {
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
    this.monitoredSegments.forEach((segment) => {
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
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
});
