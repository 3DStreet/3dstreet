/* global AFRAME */

import { BATCHING_ENABLED } from '../batch-models';

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
      default: 'none',
      oneOf: ['none', 'inbound', 'outbound']
    }
  },
  init: function () {
    this.createdEntities = [];
    this.onSegmentChanged = () => {
      const segment = this.el.components['street-segment']?.data;
      if (!segment) return;
      // Stencils depend only on length. Skip when it is unchanged since our
      // last run: the segment's first-init emit during scene load carries the
      // same length we already generated with, so regenerating would tear the
      // stencils down and recreate them identically (#1759).
      if (segment.length === this.length) return;
      this.update();
    };
    this.el.addEventListener('segment-changed', this.onSegmentChanged);
  },
  clearEntities: function () {
    // Only detach entities still connected to the DOM (see #1493).
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) entity.remove();
    });
    this.createdEntities.length = 0;
  },
  remove: function () {
    this.el.removeEventListener('segment-changed', this.onSegmentChanged);
    this.clearEntities();
  },
  update: function (oldData) {
    const segment = this.el.components['street-segment']?.data;
    if (!segment?.length) {
      return;
    }
    this.length = segment.length;
    const data = this.data;

    // Clean up old entities
    this.clearEntities();

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
        this.el.appendChild(clone);
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
          clone.setAttribute('geometry', 'height', data.stencilHeight);
          clone.components['atlas-uvs']?.update();
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

        // Lifecycle hook so batch-models frees this stencil's BatchedMesh slot from the entity's
        // own disconnectedCallback when it's regenerated / deleted (see batch-member.js). Only
        // meaningful when batching runs; skipped otherwise to avoid a component on every stencil.
        if (BATCHING_ENABLED) {
          clone.setAttribute('batch-member', '');
        }

        this.createdEntities.push(clone);
      });
    }
  }
});
