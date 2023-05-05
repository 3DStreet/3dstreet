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

takeScreenshotNow = function(filename, type, imgElement) {
  var renderer = AFRAME.scenes[0].renderer;

  function downloadImageDataURL(filename, dataURL) {
    var element = document.createElement('a');
    var url = dataURL.replace(/^data:image\/[^;]/, 'data:application/octet-stream');
    element.setAttribute('href', url);
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  }
  var saveFilename = filename + '.' + type;

  if (type == 'img') {
    imgElement.src = renderer.domElement.toDataURL()
    return;
  }
  if (type == 'png') {
      downloadImageDataURL(saveFilename, renderer.domElement.toDataURL('image/png'));
  } else {
      downloadImageDataURL(saveFilename, renderer.domElement.toDataURL('image/jpeg', 0.95));
  }
}

AFRAME.registerComponent('screentock', {
    schema: {
      takeScreenshot: { type: 'boolean', default: false },
      filename: {type: 'string', default: 'screenshot' },
      type: {type: 'string', default: 'jpg'}, // png, jpg, img
      imgElementSelector: {type: 'selector'}
    },
    tock: function () {
      // this should be paused when not in use. could be throttled too
      if (this.data.takeScreenshot) {
        this.el.setAttribute('screentock', 'takeScreenshot', false);
        takeScreenshotNow(this.data.filename, this.data.type, this.data.imgElementSelector)
      }
    }
  })