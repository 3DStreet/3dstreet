# Source File Description

## Original Libraries

### [aframe-streetmix-parsers.js](aframe-streetmix-parsers.js)
* `processSegments` - take an array of streetmix segments and render them to the DOM - untested
* `processBuildings` - takes `left`, `right` and street width
* Many other (untested) helper functions

### [aframe-streetmix-parsers-tested.js](tested/aframe-streetmix-parsers-tested.js) - Now with tests!
* `isSidewalk` - for a streetmix segment name passed as string, tell me if the segment is on a sidewalk?
* `createBuildingsArray` - create an array of dictionaries that represent a psuedorandom block of buildings for use with `create-from-json`

### [streetmix-utils.js](tested/streetmix-utils.js)
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
* does not yet support recursive (children of children)
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
