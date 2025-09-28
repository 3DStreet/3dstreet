/* global AFRAME */

// a-frame component to generate cloned models along a street
// this moves logic from aframe-streetmix-parsers into this component

AFRAME.registerComponent('street-generated-striping', {
  multiple: true,
  schema: {
    striping: {
      type: 'string',
      oneOf: [
        'none',
        'solid-stripe',
        'dashed-stripe',
        'short-dashed-stripe',
        'short-dashed-stripe-yellow',
        'solid-doubleyellow',
        'solid-dashed',
        'solid-dashed-yellow',
        'solid-dashed-yellow-mirror'
      ]
    },
    side: {
      default: 'left',
      oneOf: ['left', 'right']
    },
    facing: {
      default: 0, // this is a Y Rotation value in degrees -- UI could offer a dropdown with options for 0, 90, 180, 270
      type: 'number'
    },
    positionY: {
      // y position of clones along the length
      default: 0.05, // this is too high, instead this should component should respect elevation to follow street segment
      type: 'number'
    }
  },
  init: function () {
    this.createdEntities = [];
    // Add listener for segment width changes
    this.width = this.el.getAttribute('street-segment')?.width;
    this.el.addEventListener('segment-width-changed', (event) => {
      this.width = event.detail.newWidth;
      this.update();
    });

    this.length = this.el.getAttribute('street-segment')?.length;
    this.el.addEventListener('segment-length-changed', (event) => {
      this.length = event.detail.newLength;
      this.update();
    });
  },
  remove: function () {
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities.length = 0; // Clear the array
  },
  update: function (oldData) {
    if (!this.length || !this.width) {
      return;
    }
    // Early return if data is not yet initialized
    if (!this.data) {
      return;
    }
    const data = this.data;

    // Clean up old entities
    this.remove();

    if (!data.striping || data.striping === 'none') {
      return;
    }
    const clone = document.createElement('a-entity');
    const { stripingTextureId, repeatY, color, stripingWidth } =
      this.calculateStripingMaterial(data.striping, this.length);
    const positionX = ((data.side === 'left' ? -1 : 1) * this.width) / 2;
    clone.setAttribute('position', {
      x: positionX,
      y: data.positionY,
      z: 0
    });
    clone.setAttribute('rotation', {
      x: -90,
      y: data.facing,
      z: 0
    });
    clone.setAttribute(
      'material',
      `src: #${stripingTextureId}; alphaTest: 0; transparent:true; repeat:1 ${repeatY}; color: ${color}`
    );
    clone.setAttribute(
      'geometry',
      `primitive: plane; width: ${stripingWidth}; height: ${this.length}; skipCache: true;`
    );
    clone.classList.add('autocreated');
    // clone.setAttribute('data-ignore-raycaster', ''); // i still like clicking to zoom to individual clones, but instead this should show the generated-fixed clone settings
    clone.setAttribute('data-no-transform', '');
    clone.setAttribute(
      'data-layer-name',
      'Cloned Striping • ' + stripingTextureId
    );
    clone.setAttribute('polygon-offset', { factor: -2, units: -2 });

    this.el.appendChild(clone);
    this.createdEntities.push(clone);
  },
  calculateStripingMaterial: function (stripingName, length) {
    // calculate the repeatCount for the material
    let stripingTextureId = 'striping-solid-stripe'; // drive-lane, bus-lane, bike-lane
    let repeatY = length / 6;
    let color = '#ffffff';
    let stripingWidth = 0.2;
    if (stripingName === 'solid-stripe') {
      stripingTextureId = 'striping-solid-stripe';
    } else if (stripingName === 'dashed-stripe') {
      stripingTextureId = 'striping-dashed-stripe';
    } else if (stripingName === 'short-dashed-stripe') {
      stripingTextureId = 'striping-dashed-stripe';
      repeatY = length / 3;
    } else if (stripingName === 'short-dashed-stripe-yellow') {
      stripingTextureId = 'striping-dashed-stripe';
      repeatY = length / 3;
      color = '#f7d117';
    } else if (stripingName === 'solid-doubleyellow') {
      stripingTextureId = 'striping-solid-double';
      stripingWidth = 0.5;
      color = '#f7d117';
    } else if (stripingName === 'solid-dashed') {
      stripingTextureId = 'striping-solid-dashed';
      stripingWidth = 0.4;
    } else if (stripingName === 'solid-dashed-yellow') {
      stripingTextureId = 'striping-solid-dashed';
      color = '#f7d117';
      stripingWidth = 0.4;
    } else if (stripingName === 'solid-dashed-yellow-mirror') {
      stripingTextureId = 'striping-solid-dashed-mirror';
      color = '#f7d117';
      stripingWidth = 0.4;
    }
    return { stripingTextureId, repeatY, color, stripingWidth };
  }
});
