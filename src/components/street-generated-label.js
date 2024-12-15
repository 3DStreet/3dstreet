/* global AFRAME */

// WIP make managed street labels from canvas
// assumes existing canvas with id label-canvas
// <canvas id="my-canvas" height="512" width="2048" crossorigin="anonymous"></canvas>
//         <a-entity id="canvas-plane" geometry="primitive: plane; width: 20; height: 5" material="src: #my-canvas"

// WIP not complete
AFRAME.registerComponent('street-generated-label', {
  schema: {
    widthsArray: {
      // an array of widths in meters for which to generate labels
      type: 'array'
    },
    labelsArray: {
      // an array of labels to place at each width in the widthsArray
      // length in meters of linear path to fill with clones
      type: 'array'
    }
  },
  init: function () {
    this.createdEntities = [];
  },
  update: function (oldData) {
    // generate a function that creates a cloned set of x entities based on spacing and length values from the model shortname gltf file loaded in aframe
    const data = this.data;
    // if oldData is same as current data, then don't update
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }
    // call the drawCanvas component with the new data
  },
  createCanvas: function () {
    const canvas = document.createElement('canvas');
    canvas.id = 'label-canvas'; // assume there is only 1 per scene for now
    canvas.width = 2048;
    canvas.height = 512;
    document.body.appendChild(canvas);
  },
  drawCanvas: function () {
    // <script>
    // AFRAME.registerComponent('draw-canvas', {
    //   schema: {
    //     myCanvas: { type: 'string' },
    //     managedStreet: { type: 'string' } // json of managed street children
    //   },
    //   init: function () {
    // //        const objects = this.data.managedStreet.children;
    //     const objects = JSON.parse(this.data.managedStreet).children;
    //     this.canvas = document.getElementById(this.data);
    //     this.ctx = this.canvas.getContext('2d');
    //  // Calculate total width from all objects
    //  const totalWidth = objects.reduce((sum, obj) => sum + obj.width, 0);
    // ctx = this.ctx;
    // canvas = this.canvas;
    // // Set up canvas styling
    // ctx.fillStyle = '#ffffff';
    // ctx.fillRect(0, 0, canvas.width, canvas.height);
    // ctx.font = '24px Arial';
    // ctx.textAlign = 'center';
    // ctx.textBaseline = 'middle';
    // // Track current x position
    // let currentX = 0;
    // // Draw each segment
    // objects.forEach((obj, index) => {
    //     // Calculate proportional width for this segment
    //     const segmentWidth = (obj.width / totalWidth) * canvas.width;
    //     // Draw segment background with alternating colors
    //     ctx.fillStyle = index % 2 === 0 ? '#f0f0f0' : '#e0e0e0';
    //     ctx.fillRect(currentX, 0, segmentWidth, canvas.height);
    //     // Draw segment border
    //     ctx.strokeStyle = '#999999';
    //     ctx.beginPath();
    //     ctx.moveTo(currentX, 0);
    //     ctx.lineTo(currentX, canvas.height);
    //     ctx.stroke();
    //     // Draw centered label
    //     ctx.fillStyle = '#000000';
    //     const centerX = currentX + (segmentWidth / 2);
    //     const centerY = canvas.height / 2;
    //     // Format width number for display
    //     const label = obj.width.toLocaleString();
    //     // Draw label with background for better readability
    //     const textMetrics = ctx.measureText(label);
    //     const textHeight = 30; // Approximate height of text
    //     const padding = 10;
    //     // Draw text background
    //     ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    //     ctx.fillRect(
    //         centerX - (textMetrics.width / 2) - padding,
    //         centerY - (textHeight / 2) - padding,
    //         textMetrics.width + (padding * 2),
    //         textHeight + (padding * 2)
    //     );
    //     // Draw text
    //     ctx.fillStyle = '#000000';
    //     ctx.fillText(label, centerX, centerY);
    //     // Update x position for next segment
    //     currentX += segmentWidth;
    // });
    // // Draw final border
    // ctx.strokeStyle = '#999999';
    // ctx.beginPath();
    // ctx.moveTo(canvas.width, 0);
    // ctx.lineTo(canvas.width, canvas.height);
    // ctx.stroke();
    //     // Draw on canvas...
    //   }
    // });
    // </script>
  }
});
