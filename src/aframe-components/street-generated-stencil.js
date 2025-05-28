/* global AFRAME */

// generate cloned stencils on a street surface
AFRAME.registerComponent('street-generated-stencil', {
  multiple: true,
  schema: {
    modelsArray: {
      type: 'array',
      oneOf: [
        'sharrow',
        'bike-arrow',
        'left',
        'right',
        'straight',
        'left-straight',
        'right-straight',
        'both',
        'all',
        'word-taxi',
        'word-only',
        'word-bus',
        'word-lane',
        'word-only-small',
        'word-yield',
        'word-slow',
        'word-xing',
        'word-stop',
        'word-loading-small',
        'perpendicular-stalls',
        'parking-t',
        'hash-left',
        'hash-right',
        'hash-chevron',
        'solid-stripe'
      ]
    },
    padding: {
      // distance between stencils within array
      default: 0,
      type: 'number'
    },
    spacing: {
      // spacing in meters between clones
      default: 10,
      type: 'number'
    },
    positionX: {
      // x position of clones along the length
      default: 0,
      type: 'number'
    },
    positionY: {
      // y position of clones along the length
      default: 0.05,
      type: 'number'
    },
    cycleOffset: {
      // z (inbound/outbound) offset as a fraction of spacing value
      default: 0.5, // this is used to place different models at different z-levels with the same spacing value
      type: 'number'
    },
    facing: {
      default: 0, // this is a Y Rotation value in degrees -- UI could offer a dropdown with options for 0, 90, 180, 270
      type: 'number'
    },
    stencilHeight: {
      default: 0,
      type: 'number'
    },
    direction: {
      // specifying inbound/outbound directions will overwrite facing/randomFacing
      type: 'string',
      oneOf: ['none', 'inbound', 'outbound']
    }
  },
  init: function () {
    this.createdEntities = [];
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
  detach: function () {
    const commands = [];
    commands.push([
      'componentremove',
      { entity: this.el, component: this.attrName }
    ]);
    let entityObjToPushAtTheEnd = null; // so that the entity is selected after executing the multi command
    this.createdEntities.forEach((entity) => {
      const position = entity.getAttribute('position');
      const rotation = entity.getAttribute('rotation');
      const entityObj = {
        parentEl: this.el, // you can also put this.el.id here that way the command is fully json serializable but el currently doesn't have an id
        mixin: entity.getAttribute('mixin'),
        'data-layer-name': entity
          .getAttribute('data-layer-name')
          .replace('Cloned Model', 'Detached Model'),
        components: {
          position: { x: position.x, y: position.y, z: position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z }
        }
      };
      if (AFRAME.INSPECTOR?.selectedEntity === entity) {
        entityObjToPushAtTheEnd = entityObj;
      } else {
        commands.push(['entitycreate', entityObj]);
      }
    });
    if (entityObjToPushAtTheEnd !== null) {
      commands.push(['entitycreate', entityObjToPushAtTheEnd]);
    }
    AFRAME.INSPECTOR.execute('multi', commands);
  },
  update: function (oldData) {
    if (!this.length) {
      return;
    }
    const data = this.data;

    // Clean up old entities
    this.remove();

    // Use either stencils array or single model
    let stencilsToUse = data.modelsArray;

    // Reverse stencil order if inbound
    if (data.direction === 'inbound') {
      stencilsToUse = stencilsToUse.slice().reverse();
    }

    // Ensure minimum spacing
    this.correctedSpacing = Math.max(1, data.spacing);

    // Calculate number of stencil groups that can fit in the length
    const numGroups = Math.floor(this.length / this.correctedSpacing);

    // Create stencil groups along the street
    for (let groupIndex = 0; groupIndex < numGroups; groupIndex++) {
      const groupPosition =
        this.length / 2 -
        (groupIndex + data.cycleOffset) * this.correctedSpacing;

      // Create each stencil within the group
      stencilsToUse.forEach((stencilName, stencilIndex) => {
        const clone = document.createElement('a-entity');
        clone.setAttribute('mixin', stencilName);

        // Calculate stencil position within group
        const stencilOffset =
          (stencilIndex - (stencilsToUse.length - 1) / 2) * data.padding;

        // Set position with group position and stencil offset
        clone.setAttribute('position', {
          x: data.positionX,
          y: data.positionY,
          z: groupPosition + stencilOffset
        });

        // Handle stencil height if specified
        if (data.stencilHeight > 0) {
          clone.addEventListener('loaded', (evt) => {
            evt.target.setAttribute('geometry', 'height', data.stencilHeight);
            evt.target.components['atlas-uvs'].update();
          });
        }

        // Set rotation - either specified facing, or inbound/outbound
        let rotationY = data.facing;
        if (data.direction === 'inbound') {
          rotationY = 180 + data.facing;
        }
        if (data.direction === 'outbound') {
          rotationY = 0 - data.facing;
        }
        clone.setAttribute('rotation', `-90 ${rotationY} 0`);

        // Add metadata
        clone.classList.add('autocreated');
        clone.setAttribute('data-no-transform', '');
        clone.setAttribute('data-layer-name', `Cloned Model • ${stencilName}`);
        clone.setAttribute('data-parent-component', this.attrName);
        clone.setAttribute('polygon-offset', { factor: -2, units: -2 });

        this.el.appendChild(clone);
        this.createdEntities.push(clone);
      });
    }
  }
});
