# Source File Description

## Original Libraries

### [aframe-streetmix-loaders.js](aframe-streetmix-loaders.js)
* `loadStreet` - for a given streetmix streetURL load JSON from Streetmix, parse, and create dom elements
* `initStreet` - run up on page load: check streetmix street URL from hash, load default if none, run `loadStreet` 
* `locationHashChanged` - load new street when the url hash changes
* `processURLChange` - load new street from URL hash (this looks similar to `locationHashChanged` and may be why it renders double trains from time to time?)

### [aframe-streetmix-parsers.js](aframe-streetmix-parsers.js)
* `processSegments` - take an array of streetmix segments and render them to the DOM - untested
* Many other (untested) helper functions

### [aframe-streetmix-parsers-tested.js](tested/aframe-streetmix-parsers-tested.js) - Now with tests!
* `isSidewalk` - for a streetmix segment name passed as string, tell me if the segment is on a sidewalk?
* `createBuildingsArray` - create an array of dictionaries that represent a psuedorandom block of buildings for use with `create-from-json`

### [streetmix-utils.js](tested/streetmix-utils.js)
These are a handful of functions ([and accompanying tests!](/test/streetmix-utils-test.js) that help deal with Streetmix URLs:
* `streetmixUserToAPI(userURL)` takes a user facing Streetmix.net URL like `https://streetmix.net/kfarr/3/a-frame-city-builder-street-only` and turns it into the API redirect URL like `https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr`
* `streetmixAPIToUser(APIURL)` takes a Streetmix.net API redirect URL like `https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr` and turns it into the user facing friendly Streetmix.net URL like `https://streetmix.net/kfarr/3/a-frame-city-builder-street-only`
* `calcStreetWidth` takes an array of segments (data.streets.segments from a Streetmix API JSON String response) and returns the width in meters

### [components/anisotropy.js](components/anisotropy.js)
* `af` component sets anisotropy to a fixed value of `4` -- a reasonable default which is ignored if the OS / browser / device doesn't support it
* `anisotropy` component is a work in progress to allow specifying the anisotropy value as a component attribute, not finished or tested

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
* does not yet support recursive (children of children)
* Requires [/src/tested/create-from-json-utils-tested.js](/src/tested/create-from-json-utils-tested.js) which includes 2 [unit tests](/test/create-from-json-utils-test.js)!

## Modified Components from Elsewhere

### [lib/aframe-alongpath-component.js](lib/aframe-alongpath-component.js)
`alongpath` component modified to emit `movingstarted` each loop when `loop` = `true`, used in this project to trigger sound effects for passing vehicles. A [pull request has been filed with the original component](https://github.com/protyze/aframe-alongpath-component/pull/19).

### [components/ocean-plane.js](components/ocean-plane.js)
This is a component [originally written](https://samsunginter.net/a-frame-components/dist/ocean-plane.js) by [Ada Rose from Samsung Internet](https://samsunginter.net/a-frame-components/), copied here to specify a local path for water normals.

### [components/car.js](components/car.js)
`car` component ([original source](https://github.com/dala00/a-frame-car-sample/blob/master/index.html)) used here in some experiments and slightly modified to work with vehicles from this project.

### [components/gltf-part-draco.js](components/gltf-part-draco.js)
* `gltf-part` is a glTF loader component that extracts a part of a model with support for Draco compression. It is based on the [gltf-part component from Superframe repo](https://github.com/supermedium/superframe/tree/master/components/gltf-part) that adds support for selecting a glTF part when using Draco mesh compression on an A-Frame scene.
* `part-center` resets the location of the loaded glTF part to 0,0,0 centered using its three.js calculated bounding box. Using `excludeY: true` you can center an object at x:0, z:0 while retaining the glTF part's original Y translation. This is used for loading buildings.

### [aframe-ground-component](https://github.com/kfarr/aframe-ground-component)
`aframe-ground-component` is a modified version of the awesome [A-Frame Environment Component](https://github.com/supermedium/aframe-environment-component/) that removes environmental geometry and skybox while leaving just the ground. It also allows for reduction in triangle count by manually specifying ground elevation resolution. See more info [here on the component doc page](https://github.com/kfarr/aframe-ground-component#parameters).

### [aframe-cubemap-component](lib/aframe-cubemap-component.js)
`aframe-cubemap-component` is a local copy of [this original cubemap sky component](https://github.com/bryik/aframe-cubemap-component/).

## Unmodified Components
See [src/lib/](lib), included here to reduce fetching libraries remotely helpful for local development in bandwidth constricted environments.
