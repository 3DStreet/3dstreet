# Source File Description

### Screentock component

A Screentock component for [A-Frame](https://aframe.io), which allows you to take screenshots of your A-Frame scene.

#### Properties

| Property       | Description                                             | Type     | Default Value |
| -------------- | ------------------------------------------------------- | -------- | ------------- |
| takeScreenshot           | A flag to take a screenshot of the scene when set to true | boolean | false         |
| filename                 | The name of the saved screenshot file                   | string   | screenshot    |
| type                     | The file format of the saved screenshot (jpg, png, or img) | string   | jpg           |
| imgElementSelector       | A selector to specify the element for the screenshot image data to be copied to | selector |               |

#### Usage

##### HTML
```html
<head>
  <title>My A-Frame Scene</title>
  <script src="https://aframe.io/releases/1.4.2/aframe.min.js"></script>
  <script src="path/to/aframe-screentock-component.min.js"></script>
</head>

<body>
  <a-scene screentock>
    <a-entity geometry="primitive: box" material="color: #C03546"></a-entity>
  </a-scene>
</body>
```

##### JavaScript
```javascript
AFRAME.scenes[0].setAttribute('screentock', 'takeScreenshot', true);
```

### [index.js](index.js)
* The `street` component places a street in an A-Frame scene from a list of segments in a JSON blob. See the [`street` component documentation](https://github.com/3DStreet/3dstreet#a-frame-component) for more details.
* The `streetmix-loader` component uses a streetmix URL to supply a JSON blob for a `street` component on the same entity. See the [`streetmix-loader` component documentation](https://github.com/3DStreet/3dstreet#a-frame-streetmix-loader-component-api) for more details.
* This file also imports other libraries and functions partially described below.

### [assets.js](assets.js)
* This file provides the `street` component with the ability to automatically load 3D models and other assets using the A-Frame asset loader. It does this by adding them to the scene's `a-assets` block and then defining mixins pointing to these assets. The `street` component itself simply places entities with appropriate mixin names. To change the visual appearance of items in a scene, you can modify mixin settings defined in this assets.js file, or point your scene to a new assets root URL, or both!
* To set a custom URL for a scene's assets, add the following syntax to your `a-assets` block: `<streetmix-assets url="./"></streetmix-assets>`. Change "./" to your own path, or keep to use assets loaded from your local server.
* How does this work? Getting assets to be dynamically injected into an A-Frame scene is tricky because `a-assets` gets created in the document body, *after the streetmix javascript has been included in the header*. The contents of this file is a scheme to try to intercept the creation of `a-assets` and get them to wait for 3DStreet assets just like assets defined in the document body. It's not perfect, but seems to work. There a [Stack Overflow question and answer that goes into more detail on the original creation](https://stackoverflow.com/questions/64841550/a-frame-scene-initializes-before-assets-ready-when-dynamically-adding-a-asset-i/64868581#64868581) as well as [a GitHub Issue with additional questions and answers](https://github.com/3DStreet/3dstreet/issues/98).

### [aframe-streetmix-parsers.js](aframe-streetmix-parsers.js)
* `processSegments` function - takes an array of streetmix segments and render them to the DOM - this is the "main" function of the entire application
* `processBuildings` function - takes `left`, `right` and street width
* Many other (untested) helper functions

### [tested/aframe-streetmix-parsers-tested.js](tested/aframe-streetmix-parsers-tested.js) - Now with tests!
* `isSidewalk` function - for a streetmix segment name passed as string, tell me if the segment is on a sidewalk?
* `createBuildingsArray` function - create an array of dictionaries that represent a psuedorandom block of buildings for use with `create-from-json`

### [tested/streetmix-utils.js](tested/streetmix-utils.js)
These are a handful of functions ([and accompanying tests!](/test/streetmix-utils-test.js) that help deal with Streetmix URLs:
* `streetmixUserToAPI(userURL)` takes a user facing Streetmix.net URL like `https://streetmix.net/kfarr/3/a-frame-city-builder-street-only` and turns it into the API redirect URL like `https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr`
* `streetmixAPIToUser(APIURL)` takes a Streetmix.net API redirect URL like `https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr` and turns it into the user facing friendly Streetmix.net URL like `https://streetmix.net/kfarr/3/a-frame-city-builder-street-only`
* `calcStreetWidth` takes an array of segments (data.streets.segments from a Streetmix API JSON String response) and returns the width in meters

### [components/create-from-json.js](components/create-from-json.js)
* `create-from-json` component creates child nodes beneath the component's entity from a JSON string of an array of dictionaries that represent entities, for example:
```
<a-entity create-from-json='jsonString:
  [
    {"tag":"a-entity","mixin":"SM3D_Bld_Mixed_Corner_4fl","position":"0 0 0"},
    {"tag":"a-entity","mixin":"SM3D_Bld_Mixed_Double_5fl","position":"0 0 5"}
  ]
  '>
</a-entity>
```
which after being parsed turns into
```
<a-entity create-from-json=''>
  <a-entity mixin="SM3D_Bld_Mixed_Corner_4fl" position=""></a-entity>
  <a-entity mixin="SM3D_Bld_Mixed_Double_5fl" position="0 0 5"></a-entity>
</a-entity>
```
* does not yet support children
* Requires [/src/tested/create-from-json-utils-tested.js](/src/tested/create-from-json-utils-tested.js) which includes 2 [unit tests](/test/create-from-json-utils-test.js)!

## Modified Components from Elsewhere

### [components/ocean-plane.js](components/ocean-plane.js)
This is a component [originally written](https://samsunginter.net/a-frame-components/dist/ocean-plane.js) by [Ada Rose from Samsung Internet](https://samsunginter.net/a-frame-components/), copied here to specify a local path for water normals.

### [aframe-ground-component](https://github.com/kfarr/aframe-ground-component)
`aframe-ground-component` is a modified version of the awesome [A-Frame Environment Component](https://github.com/supermedium/aframe-environment-component/) that removes environmental geometry and skybox while leaving just the ground. It also allows for reduction in triangle count by manually specifying ground elevation resolution. See more info [here on the component doc page](https://github.com/kfarr/aframe-ground-component#parameters).

### [aframe-cubemap-component](lib/aframe-cubemap-component.js)
`aframe-cubemap-component` is a local copy of [this original cubemap sky component](https://github.com/bryik/aframe-cubemap-component/).

## Unmodified Components
See [src/lib/](lib), included here to reduce fetching libraries remotely helpful for local development in bandwidth constricted environments.

## Helpful Streetmix debugging information
Here are some tips and links from my experience "reverse engineering" Streetmix to get info out of their API.

I heavily referenced this Streetmix page which outlines all the possible segments:
https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.json

I learned a few things:
* Each street has a unique UUID (such as `7a633310-e598-11e6-80db-ebe3de713876`) with its own corresponding API endpoint (such as https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876)
* This UUID is not shown in the UI. It can be found by going to this URL and supplying the nameSpacedId and creatorId, such as: https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr . This will redirect to the UUID API endpoint
* I wrote a quick JS helper function that takes a user facing URL on Streetmix (such as https://streetmix.net/kfarr/3/a-frame-city-builder-street-only) and transforms it into the API Redirect to find the UUID endpoint. You can find the [helper function docs here](https://github.com/kfarr/3dstreet/tree/master/src#streetmix-utilsjs).

### More Notes
See [DEV-NOTES](DEV-NOTES.md) for additional notes on future features and work in progress.
