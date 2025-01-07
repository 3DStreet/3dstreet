/* global AFRAME */

AFRAME.registerComponent('street-label', {
  dependencies: ['managed-street'],

  schema: {
    heightOffset: { type: 'number', default: -2 },
    rotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
    zOffset: { type: 'number', default: 1 },
    labelHeight: { type: 'number', default: 2.5 },
    baseCanvasWidth: { type: 'number', default: 4096 }
  },

  init: function () {
    this.createdEntities = [];
    this.canvas = null;
    this.ctx = null;

    // Create and setup canvas
    this.createAndSetupCanvas();

    // Listen for segment changes
    this.el.addEventListener('segments-changed', this.updateLabels.bind(this));

    // Initial update
    this.updateLabels();

    // Handle loading from saved scene
    setTimeout(() => {
      this.updateLabels();
    }, 0);
  },

  update: function () {
    this.updateLabels();
  },
  updateLabels: function () {
    const segments = Array.from(this.el.querySelectorAll('[street-segment]'));
    if (segments.length === 0) return;

    const widthsArray = [];
    const labelsArray = [];

    segments.forEach((segmentEl) => {
      if (!segmentEl.getAttribute('street-segment')) return;

      const segmentWidth = segmentEl.getAttribute('street-segment').width;
      widthsArray.push(segmentWidth);
      labelsArray.push(segmentEl.getAttribute('data-layer-name') || '');
    });

    if (widthsArray.length !== labelsArray.length) {
      console.error('Mismatch between widths and labels arrays');
      return;
    }

    const totalWidth = widthsArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

    this.updateCanvasDimensions(totalWidth);
    this.drawLabels(widthsArray, labelsArray, totalWidth);
    this.createLabelPlane(totalWidth);
  },

  createAndSetupCanvas: function () {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'street-label-canvas';
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  },

  updateCanvasDimensions: function (totalWidth) {
    const aspectRatio = totalWidth / this.data.labelHeight;

    this.canvas.width = this.data.baseCanvasWidth;
    this.canvas.height = Math.round(this.data.baseCanvasWidth / aspectRatio);

    this.fontSize = Math.round(this.canvas.height * 0.18);
    this.subFontSize = Math.round(this.canvas.height * 0.14);
  },

  wrapText: function (text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = this.ctx.measureText(currentLine + ' ' + word).width;

      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
    return lines;
  },

  drawMultilineText: function (lines, x, y, lineHeight) {
    const totalHeight = (lines.length - 1) * lineHeight;
    const startY = y - totalHeight / 2;

    lines.forEach((line, index) => {
      const yPos = startY + index * lineHeight;
      this.ctx.fillText(line, x, yPos);
    });
  },

  drawLabels: function (widthsArray, labelsArray, totalWidth) {
    const { ctx, canvas } = this;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let currentX = 0;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    widthsArray.forEach((width, index) => {
      const segmentWidth = (parseFloat(width) / totalWidth) * canvas.width;
      const maxLabelWidth = segmentWidth * 0.9;

      // Draw segment background
      ctx.fillStyle = index % 2 === 0 ? '#f0f0f0' : '#e0e0e0';
      ctx.fillRect(currentX, 0, segmentWidth, canvas.height);

      // Draw segment border
      ctx.strokeStyle = '#999999';
      ctx.beginPath();
      ctx.moveTo(currentX, 0);
      ctx.lineTo(currentX, canvas.height);
      ctx.stroke();

      // Draw width value
      ctx.fillStyle = '#000000';
      ctx.font = `${this.fontSize}px Arial`;
      const centerX = currentX + segmentWidth / 2;
      const centerY = canvas.height / 2 - 50;

      const widthText = parseFloat(width).toFixed(1) + 'm';
      ctx.fillText(widthText, centerX, centerY - this.fontSize * 0.8);

      // Draw wrapped label text
      if (labelsArray[index]) {
        ctx.font = `${this.subFontSize}px Arial`;
        const lines = this.wrapText(labelsArray[index], maxLabelWidth);
        const lineHeight = this.subFontSize * 1.2;
        this.drawMultilineText(
          lines,
          centerX,
          centerY + this.fontSize * 0.4 + 75,
          lineHeight
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

  createLabelPlane: function (totalWidth) {
    // Remove existing entities
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });
    this.createdEntities = [];

    // Create new label plane
    const plane = document.createElement('a-entity');

    plane.setAttribute('geometry', {
      primitive: 'plane',
      width: totalWidth,
      height: this.data.labelHeight
    });

    plane.setAttribute('material', {
      src: '#street-label-canvas',
      transparent: true,
      alphaTest: 0.5
    });

    plane.setAttribute(
      'position',
      `0 ${this.data.heightOffset} ${this.data.zOffset}`
    );
    plane.setAttribute(
      'rotation',
      `${this.data.rotation.x} ${this.data.rotation.y} ${this.data.rotation.z}`
    );
    plane.setAttribute('data-layer-name', 'Segment Labels');
    plane.classList.add('autocreated');

    this.el.appendChild(plane);
    this.createdEntities.push(plane);
  },

  remove: function () {
    // Clean up canvas
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    // Remove created entities
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) {
        entity.parentNode.removeChild(entity);
      }
    });
    this.createdEntities = [];

    // Remove event listener
    this.el.removeEventListener('segments-changed', this.updateLabels);
  }
});
