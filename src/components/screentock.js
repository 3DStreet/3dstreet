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

    function downloadImage (filename, dataURL) { 
      downloadImageDataURL(filename, dataURL);
      // show helpers
      toggleHelpers(true);
    }

    function toggleHelpers(show) {
      if (inspector && inspector.opened) inspector.sceneHelpers.visible = show;
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
    
    renderer.render(AFRAME.scenes[0].object3D, AFRAME.scenes[0].camera);

    if (type == 'img') {
      imgElement.src = renderer.domElement.toDataURL();
      return;
    }
    if (type == 'png') {
      downloadImage(saveFilename, renderer.domElement.toDataURL('image/png'));
    } else {
      downloadImage(saveFilename, renderer.domElement.toDataURL('image/jpeg', 0.95));
    }
  },
  update: function () {
    // this should be paused when not in use. could be throttled too
    if (this.data.takeScreenshot) {
      this.data.takeScreenshot = false;
      this.takeScreenshotNow(this.data.filename, this.data.type, this.data.imgElementSelector);
    }   
  }
});
