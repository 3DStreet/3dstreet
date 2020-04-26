# Source File Description

## Original Libraries

### [aframe-streetmix.js](aframe-streetmix.js)
This is the meat of the project. It should eventually be refactored to be a standard A-Frame component instead of a set of spaghetti functions.

### [streetmix-utils.js](streetmix-utils.js)
These are a handful of functions that help deal with Streetmix URLs:
* `streetmixUserToAPI(userURL)` takes a user facing Streetmix.net URL like `https://streetmix.net/kfarr/3/a-frame-city-builder-street-only` and turns it into the API redirect URL like `https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr`
* `streetmixAPIToUser(APIURL)` takes a Streetmix.net API redirect URL like `https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr` and turns it into the user facing friendly Streetmix.net URL like `https://streetmix.net/kfarr/3/a-frame-city-builder-street-only`

### [components/anisotropy.js](components/anisotropy.js)
* `af` component is a simple function that sets anisotropy to a fixed value of `4` -- a reasonable default which is ignored if the OS / browser / device doesn't support it
* `anisotropy` component is a work in progress to allow specifying the anisotropy value as a component attribute, not finished or tested

## Modified Components from Elsewhere

### [components/aframe-alongpath-component.js](components/aframe-alongpath-component.js)
`alongpath` component modified to emit `movingstarted` each loop when `loop` = `true`, used in this project to trigger sound effects for passing vehicles. A [pull request has been filed with the original component](https://github.com/protyze/aframe-alongpath-component/pull/19).

### [components/ocean-plane.js](components/ocean-plane.js)
This is a component [originally written](https://samsunginter.net/a-frame-components/dist/ocean-plane.js) by [Ada Rose from Samsung Internet](https://samsunginter.net/a-frame-components/), copied here to specify a local path for water normals.

### [components/car.js](components/car.js)
`car` component ([original source](https://github.com/dala00/a-frame-car-sample/blob/master/index.html)) used here in some experiments and slightly modified to work with vehicles from this project.

### [components/gltf-part-reset.js](components/gltf-part-reset.js)
`gltf-part-reset` is a slightly modified glTF loader component based on code from Mozilla Hubs that allows for resetting the relative location of a glTF part when loading individual parts from a larger glTF file.

### [aframe-ground-component](https://github.com/kfarr/aframe-ground-component)
`aframe-ground-component` is a modified version of the awesome [A-Frame Environment Component](https://github.com/supermedium/aframe-environment-component/) that removes removes environmental geometry and skybox while leaving just the ground. It also allows for reduction in triangle count to improve performance.

## Unmodified Components
See [src/lib/](lib), included here to reduce fetching libraries remotely helpful for local development in bandwidth constricted environments.
