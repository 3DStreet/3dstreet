AFRAME.registerComponent('street-ground', {
  dependencies: ['managed-street', 'street-align'],

  init: function () {
    // Listen for any changes from managed-street
    this.el.addEventListener('segments-changed', () =>
      this.createOrUpdateDirtbox()
    );

    // Listen for alignment changes
    this.el.addEventListener('alignment-changed', () =>
      this.createOrUpdateDirtbox()
    );

    // Create initial dirtbox
    this.createOrUpdateDirtbox();

    setTimeout(() => {
      this.createOrUpdateDirtbox();
    }, 0);
  },

  createOrUpdateDirtbox: function () {
    console.log('dirtbox fired update');
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

    // Get all segments
    const segments = Array.from(this.el.querySelectorAll('[street-segment]'));
    if (segments.length === 0) return;

    const totalWidth = segments.reduce((sum, segment) => {
      return sum + (segment.getAttribute('street-segment')?.width || 0);
    }, 0);
    const streetLength = this.el.getAttribute('managed-street')?.length || 0;

    // Update dirtbox dimensions
    this.dirtbox.setAttribute('height', 2);
    this.dirtbox.setAttribute('width', totalWidth);
    this.dirtbox.setAttribute('depth', streetLength - 0.2);

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

    this.dirtbox.setAttribute('position', `${xPosition} -1 ${zPosition}`);
  },

  remove: function () {
    // Clean up
    if (this.dirtbox) {
      this.dirtbox.parentNode.removeChild(this.dirtbox);
    }
    this.el.removeEventListener('segments-changed', this.createOrUpdateDirtbox);
  }
});
