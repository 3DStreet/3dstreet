/* AFRAME */
import useStore from '../store';

AFRAME.registerComponent('screentock', {
  schema: {
    takeScreenshot: { type: 'boolean', default: false },
    filename: { type: 'string', default: 'screenshot' },
    type: { type: 'string', default: 'jpg' }, // png, jpg, img
    imgElementSelector: { type: 'selector' },
    // New title styling properties
    showLogo: { type: 'boolean', default: true },
    showTitle: { type: 'boolean', default: true },
    titleFont: { type: 'string', default: 'Lato' },
    titleSize: { type: 'number', default: 10 },
    titleColor: { type: 'color', default: '#FFFFFF' },
    titleStroke: { type: 'boolean', default: false },
    titleStrokeColor: { type: 'color', default: '#000000' },
    titleStrokeWidth: { type: 'number', default: 1 }
  },

  addStyledTitleToCanvas: function (ctx, screenWidth, screenHeight) {
    const titleText = useStore.getState().sceneTitle;
    const fontSize = this.data.titleSize * 10;
    const strokeWidth = this.data.titleStroke * 10;

    // Set font properties
    ctx.font = `${fontSize}px ${this.data.titleFont}`;
    ctx.textAlign = 'center';

    // Add stroke if enabled
    if (this.data.titleStroke) {
      ctx.strokeStyle = this.data.titleStrokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.strokeText(
        titleText,
        screenWidth - screenWidth / 2,
        screenHeight - 43
      );
    }

    // Fill text
    ctx.fillStyle = this.data.titleColor;
    ctx.fillText(titleText, screenWidth - screenWidth / 2, screenHeight - 43);
  },

  takeScreenshotNow: function (filename, type, imgElement) {
    const inspector = AFRAME.INSPECTOR;
    const renderer = AFRAME.scenes[0].renderer;

    // hide helpers
    const toggleHelpers = (show) => {
      if (inspector && inspector.opened) inspector.sceneHelpers.visible = show;
    };

    toggleHelpers(false);

    const createCanvasWithScreenshot = (aframeCanvas) => {
      let screenshotCanvas = document.querySelector('#screenshotCanvas');
      if (!screenshotCanvas) {
        screenshotCanvas = document.createElement('canvas');
        screenshotCanvas.id = 'screenshotCanvas';
        screenshotCanvas.hidden = true;
        document.body.appendChild(screenshotCanvas);
      }
      screenshotCanvas.width = aframeCanvas.width;
      screenshotCanvas.height = aframeCanvas.height;
      const ctxScreenshot = screenshotCanvas.getContext('2d');

      // draw image from Aframe canvas to screenshot canvas
      ctxScreenshot.drawImage(aframeCanvas, 0, 0);
      // add scene title to screenshot with custom styling
      if (this.data.showTitle) {
        this.addStyledTitleToCanvas(
          ctxScreenshot,
          screenshotCanvas.width,
          screenshotCanvas.height
        );
      }
      // add 3DStreet logo
      if (this.data.showLogo) {
        addLogoToCanvas(ctxScreenshot);
      }
      return screenshotCanvas;
    };

    const addLogoToCanvas = (ctx) => {
      const logoImg = document.querySelector('#screenshot-img');
      ctx.drawImage(logoImg, 0, 0, 135, 43, 40, 30, 270, 86);
    };

    const downloadImageDataURL = (filename, dataURL) => {
      const element = document.createElement('a');
      const url = dataURL.replace(
        /^data:image\/[^;]/,
        'data:application/octet-stream'
      );
      element.setAttribute('href', url);
      element.setAttribute('download', filename);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    };

    const saveFilename = filename + '.' + type;

    // render one frame
    renderer.render(AFRAME.scenes[0].object3D, AFRAME.scenes[0].camera);
    const screenshotCanvas = createCanvasWithScreenshot.call(
      this,
      renderer.domElement
    );

    if (type === 'img') {
      imgElement.src = screenshotCanvas.toDataURL();
    }
    if (type === 'png') {
      downloadImageDataURL(
        saveFilename,
        screenshotCanvas.toDataURL('image/png')
      );
    } else if (type === 'jpg') {
      downloadImageDataURL(
        saveFilename,
        screenshotCanvas.toDataURL('image/jpeg', 0.95)
      );
    }
    // show helpers
    toggleHelpers(true);
  },

  update: function (oldData) {
    // If `oldData` is empty, then this means we're in the initialization process.
    // No need to update.
    if (Object.keys(oldData).length === 0) {
      return;
    }

    // this should be paused when not in use. could be throttled too
    if (this.data.takeScreenshot) {
      this.data.takeScreenshot = false;
      this.takeScreenshotNow(
        this.data.filename,
        this.data.type,
        this.data.imgElementSelector
      );
    }
  }
});
