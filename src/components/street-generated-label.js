/* global AFRAME */

AFRAME.registerComponent('street-generated-label', {
  schema: {
    widthsArray: {
      // an array of widths in meters for which to generate labels
      type: 'array'
    },
    labelsArray: {
      // an array of labels to place at each width in the widthsArray
      type: 'array'
    }
  },

  init: function () {
    this.createdEntities = [];
    this.canvas = null;
    this.ctx = null;
    this.createAndSetupCanvas();
  },

  update: function (oldData) {
    const data = this.data;
    // if oldData is same as current data, then don't update
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }

    // Only proceed if we have matching arrays
    if (data.widthsArray.length !== data.labelsArray.length) {
      console.error('widthsArray and labelsArray must have the same length');
      return;
    }

    this.drawLabels();
    this.createLabelPlane();
  },

  remove: function () {
    // Clean up canvas when component is removed
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    // Remove any created entities
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });
    this.createdEntities = [];
  },

  createAndSetupCanvas: function () {
    // Create canvas if it doesn't exist
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'street-label-canvas';
    this.canvas.width = 2048; // Relatively high resolution for clarity
    this.canvas.height = 256;
    this.canvas.style.display = 'none'; // Hide the canvas element
    document.body.appendChild(this.canvas);

    // Get context
    this.ctx = this.canvas.getContext('2d');
  },

  drawLabels: function () {
    const { ctx, canvas } = this;
    const { widthsArray, labelsArray } = this.data;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Set up canvas styling
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate total width
    const totalWidth = widthsArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

    // Track current x position
    let currentX = 0;

    // Set up text styling
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw segments and labels
    widthsArray.forEach((width, index) => {
      const segmentWidth = (parseFloat(width) / totalWidth) * canvas.width;

      // Draw segment background
      ctx.fillStyle = index % 2 === 0 ? '#f0f0f0' : '#e0e0e0';
      ctx.fillRect(currentX, 0, segmentWidth, canvas.height);

      // Draw segment border
      ctx.strokeStyle = '#999999';
      ctx.beginPath();
      ctx.moveTo(currentX, 0);
      ctx.lineTo(currentX, canvas.height);
      ctx.stroke();

      // Draw label
      ctx.fillStyle = '#000000';
      const centerX = currentX + segmentWidth / 2;
      const centerY = canvas.height / 2;

      // Draw width value
      const widthText = parseFloat(width).toFixed(1) + 'm';
      ctx.fillText(widthText, centerX, centerY - 30);

      // Draw label text if provided
      if (labelsArray[index]) {
        ctx.font = '36px Arial'; // Smaller font for the label
        ctx.fillText(labelsArray[index], centerX, centerY + 30);
        ctx.font = '48px Arial'; // Reset font size
      }

      currentX += segmentWidth;
    });

    // Draw final border
    ctx.strokeStyle = '#999999';
    ctx.beginPath();
    ctx.moveTo(canvas.width, 0);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.stroke();
  },

  createLabelPlane: function () {
    // Remove any existing label planes
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });
    this.createdEntities = [];

    // Create new plane with the canvas texture
    const plane = document.createElement('a-entity');

    // Calculate total width from widthsArray
    const totalWidth = this.data.widthsArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

    plane.setAttribute('geometry', {
      primitive: 'plane',
      width: totalWidth, // Use actual street width in meters
      height: 2.5 // Height in meters
    });

    console.log('totalWidth from generated-label', totalWidth);

    // Set material to use the canvas
    plane.setAttribute('material', {
      src: '#street-label-canvas',
      transparent: true,
      alphaTest: 0.5
    });

    // Position above the street
    plane.setAttribute('position', '0 -2 1');
    plane.setAttribute('rotation', '-30 0 0'); // Angle slightly toward viewer

    plane.setAttribute('data-layer-name', 'Segment Labels');
    plane.classList.add('autocreated');

    // Add to scene
    this.el.appendChild(plane);
    this.createdEntities.push(plane);
  }
});
