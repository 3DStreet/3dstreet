const functions = require('firebase-functions');

// Function to serve a modified version of index.html with WebXR variant launch script
exports.serveWebXRVariant = functions.https.onRequest((req, res) => {
  // HTML template with the WebXR variant launch script
  const htmlTemplate = `<!DOCTYPE html>
<html>

<head>
  <!-- WebXR variant launch script -->
  <script src="https://launchar.app/sdk/v1?key=5FXAKdmPAUHi5QV6zkUt8wPkBl6Wa4p6&redirect=true"></script>
  <!-- aframe -->
  <script src="https://aframe.io/releases/1.7.1/aframe.min.js"></script>
  <!-- 3dstreet -->
  <script src="/dist/aframe-street-component.js"></script>
  <!-- sentry -->
  <script src="https://js.sentry-cdn.com/941ec1dfd6b01567fe3fd16db9cbaa54.min.js" crossorigin="anonymous"></script>
  <!-- mapbox -->
  <script src="/dist/aframe-mapbox-component.min.js"></script>

  <!-- viewer controls - vr teleport -->
  <script src="https://cdn.jsdelivr.net/npm/aframe-blink-controls@0.4.3/dist/aframe-blink-controls.min.js"></script>

  <title>3DStreet WebXR Variant</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" type="image/x-icon" href="ui_assets/favicon.ico">
  <link rel="stylesheet" href="/dist/viewer-styles.css">
</head>

<body>
  <img id="screenshot-img" src="ui_assets/3DStreet-Viewer-Start-Editor.svg" alt="Invisible Image" style="display:none;">
  <!-- loading animation start -->
  <div class="loader__wrapper">
    <div class="loader">
      <div class="road">Loading 3DStreet WebXR Variant</div>
    </div>
  </div>

  <!-- maps copyright start -->
  <div id="map-data-attribution" style="visibility: hidden;">
    <div id="map-logo">Map Attribution:</div>
    <span id="map-copyright"></span>
  </div>

  <!-- Viewer Mode UI - shown when inspector not visible -->
  <div id="viewer-mode-ui">
    <!-- AR Play Button - shown if device supports XR mode -->
    <div id="viewer-mode-ar-play-button"></div>
    <!-- AR Error Message - shown if device does not support WebXR AR mode -->
    <div id="viewer-mode-ar-webxr-not-supported">
      Device does not support WebXR.
    </div>
    <!-- Viewer Mode - Locomotion Instructions -->
    <div id="viewer-mode-locomotion-controls">
      <div class="controls-container">
        <div class="controls-title">Controls</div>
        <div class="controls-item">
          <span class="key-group">W A S D</span> or <span class="key-group">Arrow Keys</span> to move
        </div>
        <div class="controls-item">
          <span class="key-group">Click + Drag</span> to pan screen
        </div>
      </div>
    </div>
  </div>

  <!-- AR Overlay - only shown when in AR mode -->
  <div id="viewer-mode-ar-overlay">
    <button id="viewer-mode-ar-overlay-exit-button" onclick="AFRAME.scenes[0].renderer.xr.getSession().end()">Exit AR Mode</button>
    <div id="react-ar-controls"></div>
    <div id="react-visibility-toggle"></div>
  </div>

  <!-- <div class="right-fixed">
    <ul class="right-menu">
      <li onclick="buttonScreenshotTock()"> <a class="camera" href="#"> <span> Capture image as PNG </span> <img
            src="ui_assets/camera-icon.svg"> </a></li>
      <li onclick="STREET.utils.inputStreetmix()"> <a class="load" href="#"> <span> Load Streetmix URL </span> <img
            src="ui_assets/streetmix-logo.svg"> </a></li>
      <li onclick="inputJSON()"> <a class="load"  href="#"> <span> Load JSON String </span> <img src="assets/ui_assets/upload-icon.svg"> </a></li>
      <li><a class="load"> <label for="inputfile" style="display: inherit; align-items: center; cursor: pointer"> <input
              type="file" id="inputfile" style="display:none" accept=".js, .json, .txt"> <span> Load JSON File </span>
            <img src="ui_assets/upload-icon.svg"></label></a></li>
    </ul>
  </div> -->

  <a-scene
    renderer="colorManagement: true; physicallyCorrectLights: true; anisotropy: 16; logarithmicDepthBuffer: true;"
    loading-screen="enabled: false" notify metadata
    device-orientation-permission-ui="enabled: false"
    reflection device-orientation-permission-ui="enabled: false"
    webxr="requiredFeatures:hit-test,local-floor,dom-overlay;referenceSpaceType:local-floor;overlayElement:#viewer-mode-ar-overlay"
    xr-mode-ui="XRMode: ar; enterARButton: #viewer-mode-ar-play-button;"
    css2d-renderer scene-timer="autoStart: false; format: mm:ss:ff">
    <a-assets>
      <!-- TODO: Add this to repo documentation  -->
      <!-- you can specify a custom asset path using below syntax  -->

      <!-- uncomment the line below to load assets from local github submodule -->
      <!-- <street-assets url="./assets/"></street-assets>   -->

      <!-- you can specify a subset of categories of objects to load using below syntax  -->

      <!-- uncomment the line below to load all possible asset categories -->
      <!-- <street-assets categories="sidewalk-props people people-rigged vehicles vehicles-rigged buildings intersection-props segment-textures segment-colors lane-separator stencils vehicles-transit dividers sky grounds"></street-assets>   -->

      <!-- a reduced set of assets for non-animated streetmix streets without intersections -->
      <!-- <street-assets categories="loud-bicycle sidewalk-props people vehicles vehicles-rigged buildings segment-textures segment-colors lane-separator stencils vehicles-transit dividers sky grounds"></street-assets> -->

    </a-assets>


    <a-entity id="reference-layers" data-layer-name="Geospatial Layers" data-no-transform></a-entity>

    <a-entity id="environment" data-layer-name="Environment" street-environment="preset: day;" data-no-transform></a-entity>

    <a-entity id="cameraRig" class="ph-no-capture" data-layer-name="Viewer" data-no-transform viewer-mode="preset: camera-path;"
      cursor-teleport="cameraRig: #cameraRig; cameraHead: #camera;"
      movement-controls="camera: #camera; fly: true">
      <a-entity id="camera" data-layer-name="Camera" position="0 1.6 0" camera look-controls="reverseMouseDrag: true" class="autocreated"></a-entity>
      <a-entity id="leftHand" hand-controls="hand: left;" data-layer-name="Left Controls" class="autocreated" data-no-transform=""
        blink-controls="cameraRig: #cameraRig; teleportOrigin: #camera; rotateOnTeleport:false;"></a-entity>
      <a-entity id="rightHand" hand-controls="hand: right" data-layer-name="Right Controls" class="autocreated" data-no-transform=""
        blink-controls="cameraRig: #cameraRig; teleportOrigin: #camera; rotateOnTeleport:false;"></a-entity>
      <a-entity
        id="screenshot"
        data-layer-name="Focus Animation"
        data-no-pause=""
        data-no-transform=""
        focus-animation
        screentock
        visible="false"
        class="autocreated"
      ></a-entity>
    </a-entity>

    <a-entity id="street-container" data-layer-name="User Layers" data-no-transform>
      <a-entity id="default-street" street streetmix-loader set-loader-from-hash></a-entity>
    </a-entity>

  </a-scene>
</body>
<script>
  /* loading animation script */
  document.addEventListener('DOMContentLoaded', function () {
    const scene = document.querySelector('a-scene');
    const splash = document.querySelector('.loader__wrapper');
    scene.addEventListener('loaded', function (e) {
      setTimeout(() => {
        splash.style.display = 'none';
      }, 1000);
    });
  });

  // XR session error handling
  if (navigator.xr) {
    const originalRequestSession = navigator.xr.requestSession.bind(navigator.xr);
    navigator.xr.requestSession = async function(...args) {
      try {
        return await originalRequestSession(...args);
      } catch (error) {
        if (window.STREET?.notify) {
          STREET.notify.errorMessage('XR session failed: ' + error.name);
        }
        throw error;
      }
    };
  }
</script>

</html>`;

  // Set the content type to HTML
  res.set('Content-Type', 'text/html');
  
  // Send the HTML template as the response
  res.send(htmlTemplate);
});