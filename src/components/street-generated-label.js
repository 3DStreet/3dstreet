/* global AFRAME */

AFRAME.registerComponent('street-generated-label', {
  schema: {
    widthsArray: {
      type: 'array'
    },
    labelsArray: {
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
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }

    if (data.widthsArray.length !== data.labelsArray.length) {
      console.error('widthsArray and labelsArray must have the same length');
      return;
    }

    // Calculate total width before drawing
    const totalWidth = this.data.widthsArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

    // Update canvas dimensions to match the plane's aspect ratio
    this.updateCanvasDimensions(totalWidth);

    this.drawLabels();
    this.createLabelPlane();
  },

  remove: function () {
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });
    this.createdEntities = [];
  },

  createAndSetupCanvas: function () {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'street-label-canvas';
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  },

  updateCanvasDimensions: function (totalWidth) {
    // Set canvas dimensions to match the final display ratio
    // Using the plane's height of 2.5 meters as reference
    const PLANE_HEIGHT = 2.5;
    const aspectRatio = totalWidth / PLANE_HEIGHT;

    // Base canvas width on a reasonable pixel density
    const BASE_WIDTH = 4096;
    this.canvas.width = BASE_WIDTH;
    this.canvas.height = Math.round(BASE_WIDTH / aspectRatio);

    // Scale font sizes based on canvas dimensions
    this.fontSize = Math.round(this.canvas.height * 0.14); // Main font size
    this.subFontSize = Math.round(this.canvas.height * 0.12); // Secondary font size
  },

  drawLabels: function () {
    const { ctx, canvas } = this;
    const { widthsArray, labelsArray } = this.data;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const totalWidth = widthsArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

    let currentX = 0;

    // Set up text styling with dynamic font sizes
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    widthsArray.forEach((width, index) => {
      const segmentWidth = (parseFloat(width) / totalWidth) * canvas.width;

      // Draw segment background
      ctx.fillStyle = index % 2 === 0 ? '#f0f0f0' : '#e0e0e0';
      ctx.fillRect(currentX, 0, segmentWidth, canvas.height);

      // Draw segment border
      ctx.strokeStyle = '#000000';
      ctx.beginPath();
      ctx.moveTo(currentX, 0);
      ctx.lineTo(currentX, canvas.height);
      ctx.stroke();

      // Draw width value with scaled font
      ctx.fillStyle = '#000000';
      ctx.font = `${this.fontSize}px Arial`;
      const centerX = currentX + segmentWidth / 2;
      const centerY = canvas.height / 2;

      const widthText = parseFloat(width).toFixed(1) + 'm';
      ctx.fillText(widthText, centerX, centerY - this.fontSize * 0.6);

      // Draw label text if provided
      if (labelsArray[index]) {
        ctx.font = `${this.subFontSize}px Arial`;
        ctx.fillText(
          labelsArray[index],
          centerX,
          centerY + this.fontSize * 0.6
        );
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
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });
    this.createdEntities = [];

    const plane = document.createElement('a-entity');
    const totalWidth = this.data.widthsArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

    plane.setAttribute('geometry', {
      primitive: 'plane',
      width: totalWidth,
      height: 2.5
    });

    plane.setAttribute('material', {
      src: '#street-label-canvas',
      transparent: true,
      alphaTest: 0.5
    });

    plane.setAttribute('position', '0 -2 1');
    plane.setAttribute('rotation', '-30 0 0');
    plane.setAttribute('data-layer-name', 'Segment Labels');
    plane.classList.add('autocreated');

    this.el.appendChild(plane);
    this.createdEntities.push(plane);
  }
});
