/* AFRAME */

// function buttonScreenshotTock() {
//   AFRAME.scenes[0].setAttribute('screentock', 'type', 'jpg');
//   AFRAME.scenes[0].setAttribute('screentock', 'takeScreenshot', true);
// }
// function buttonScreenshotTockPNG() {
//   AFRAME.scenes[0].setAttribute('screentock', 'type', 'png');
//   AFRAME.scenes[0].setAttribute('screentock', 'takeScreenshot', true);
// }
// function buttonCaptureImage() {
//   AFRAME.scenes[0].setAttribute('screentock', 'type', 'img');
//   AFRAME.scenes[0].setAttribute('screentock', 'imgElementSelector', '#captureImg');
//   AFRAME.scenes[0].setAttribute('screentock', 'takeScreenshot', true);
// }

AFRAME.registerComponent('screentock', {
  schema: {
    takeScreenshot: { type: 'boolean', default: false },
    filename: { type: 'string', default: 'screenshot' },
    type: { type: 'string', default: 'jpg' }, // png, jpg, img
    imgElementSelector: { type: 'selector' }
  },
  takeScreenshotNow: function (filename, type, imgElement) {
    const inspector = AFRAME.INSPECTOR;
    const renderer = AFRAME.scenes[0].renderer;

    // hide helpers
    toggleHelpers(false);

    function toggleHelpers(show) {
      if (inspector && inspector.opened) inspector.sceneHelpers.visible = show;
    }

    function createCanvasWithScreenshot(aframeCanvas) {
      let screenshotCanvas = document.querySelector('#screenshotCanvas');
      if (!screenshotCanvas) {
        screenshotCanvas = document.createElement('canvas');
        screenshotCanvas.id = 'screenshotCanvas';
        screenshotCanvas.hidden = true;
        document.body.appendChild(screenshotCanvas);
      }
      screenshotCanvas.width = aframeCanvas.width;
      screenshotCanvas.height = aframeCanvas.height;      
      const ctxScreenshot = screenshotCanvas.getContext("2d");

      // draw image from Aframe canvas to screenshot canvas
      ctxScreenshot.drawImage(aframeCanvas, 0, 0);
      // add scene title to screenshot
      addTitleToCanvas(ctxScreenshot, screenshotCanvas.width, screenshotCanvas.height);
      // add 3DStreet logo
      addLogoToCanvas(ctxScreenshot);
      return screenshotCanvas;
    }

    function addTitleToCanvas (ctx, screenWidth, screenHeight) {
      ctx.font = "25px Lato";
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFF';
      ctx.fillText(STREET.utils.getCurrentSceneTitle(), 
        screenWidth - screenWidth/2, 
        screenHeight - 43);
    }

    function addLogoToCanvas (ctx) {
      ctx.font = "lighter 40px sans-serif";
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFF';
      ctx.fillText('3D', 
        50, 
        80);
      ctx.font = "Bolder 40px sans-serif";
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFF';
      ctx.fillText('Street', 
        100, 
        80);

      //const logoImg = document.querySelector('img.viewer-logo-img');
      //ctx.drawImage(logoImg, 0, 0, 250, 43, 40, 40, 250, 43);
    }

    function downloadImageDataURL (filename, dataURL) {
      const element = document.createElement('a');
      const url = dataURL.replace(/^data:image\/[^;]/, 'data:application/octet-stream');
      element.setAttribute('href', url);
      element.setAttribute('download', filename);
      element.style.display = 'none';
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    }
    const saveFilename = filename + '.' + type;
    
    // render one frame
    renderer.render(AFRAME.scenes[0].object3D, AFRAME.scenes[0].camera);
    const screenshotCanvas = createCanvasWithScreenshot(renderer.domElement);

    if (type == 'img') {
      imgElement.src = renderer.domElement.toDataURL();
      return;
    }
    if (type == 'png') {
      downloadImageDataURL(saveFilename, screenshotCanvas.toDataURL('image/png'));
    } else {
      downloadImageDataURL(saveFilename, screenshotCanvas.toDataURL('image/jpeg', 0.95));
    }
    // show helpers
    toggleHelpers(true);
  },
  update: function () {
    // this should be paused when not in use. could be throttled too
    if (this.data.takeScreenshot) {
      this.data.takeScreenshot = false;
      this.takeScreenshotNow(this.data.filename, this.data.type, this.data.imgElementSelector);
    }   
  }
});
