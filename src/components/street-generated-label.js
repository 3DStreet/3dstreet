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

    const totalWidth = this.data.widthsArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

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
    const PLANE_HEIGHT = 2.5;
    const aspectRatio = totalWidth / PLANE_HEIGHT;

    const BASE_WIDTH = 4096;
    this.canvas.width = BASE_WIDTH;
    this.canvas.height = Math.round(BASE_WIDTH / aspectRatio);

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

  drawLabels: function () {
    const { ctx, canvas } = this;
    const { widthsArray, labelsArray } = this.data;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const totalWidth = widthsArray.reduce(
      (sum, width) => sum + parseFloat(width),
      0
    );

    let currentX = 0;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    widthsArray.forEach((width, index) => {
      const segmentWidth = (parseFloat(width) / totalWidth) * canvas.width;
      const maxLabelWidth = segmentWidth * 0.9; // 90% of segment width for padding

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

      // Draw wrapped label text if provided
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
