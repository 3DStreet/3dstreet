
# Change Log
All notable changes to this project will be documented in this file.
 
The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).
 
## 0.4.1 - 2023-08-08

### What's Changed

### Major improvements
* v2 save / load - ability to edit a 3DStreet JSON file previously saved including environment and reference layers
* ability to load 3DStreet json file from third-party path (precursor to cloud)
* ability to update night / day live (street-environment component)
* improve asset loading - lazy load vehicles (only load vehicles when needed for scene)

### Changes and additions
* Sidewalk segment variants by @Algorush in https://github.com/3DStreet/3dstreet/pull/276
* add perpendicular parking option by @Algorush in https://github.com/3DStreet/3dstreet/pull/273
* New Screentock component by @kfarr in https://github.com/3DStreet/3dstreet/pull/277
* support new LRV by @kfarr in https://github.com/3DStreet/3dstreet/pull/289
* Lazy load rigged vehicles by @kfarr in https://github.com/3DStreet/3dstreet/pull/296
* Add first version to load JSON from URL by @Algorush in https://github.com/3DStreet/3dstreet/pull/304
* add update environment option by @Algorush in https://github.com/3DStreet/3dstreet/pull/307
* add environment node support by @Algorush in https://github.com/3DStreet/3dstreet/pull/300
* add attribute to ignore raycaster on env-sky element by @Algorush in https://github.com/3DStreet/3dstreet/pull/312
* Notification component by @Algorush in https://github.com/3DStreet/3dstreet/pull/319
* add layers-2d node support to save/load by @Algorush in https://github.com/3DStreet/3dstreet/pull/320
* rename layers-2 entity by @Algorush in https://github.com/3DStreet/3dstreet/pull/326
* fewer pedestrians in 'sparse' mode by @Algorush in https://github.com/3DStreet/3dstreet/pull/328
* Add console log for npm version number and github hash by @sweep-ai in https://github.com/3DStreet/3dstreet/pull/324
* brt station segment support by @Algorush https://github.com/3DStreet/3dstreet/pull/268

### Fixed
* fix NaN issue with pedestrians by @Algorush in https://github.com/3DStreet/3dstreet/pull/283
* fix empty building variant showing by @Algorush in https://github.com/3DStreet/3dstreet/pull/285
* Save load fixing by @Algorush in https://github.com/3DStreet/3dstreet/pull/287
* Save load fixing by @Algorush in https://github.com/3DStreet/3dstreet/pull/310
* fix saving issue by @Algorush in https://github.com/3DStreet/3dstreet/pull/321
* return parking-t mixin by @Algorush in https://github.com/3DStreet/3dstreet/pull/302

**Full Changelog**: https://github.com/3DStreet/3dstreet/compare/0.4.0...0.4.1

## 0.4.0 - 2023-05-04

Never too late to start a changelog, eh?

### Changes and additions
* v1 save / load
* support for a-frame 1.4; updated asset loader
* [basic ui for loading streets and scenes (right-side)](https://github.com/3DStreet/3dstreet/pull/219)
* asset upgrades and new assets
* switch to draco for most assets
* add loud bicycle assets (draco, lazy load)
* random vehicle positioning
* elevated sidewalks and intersection curbs
* cursor teleport or WASD on desktop browsers (instead of orbit controls)
* vehicle wheel animation support
* basic character animation support
* simple day / night environment component

### Fixed
* segments beneath street level have closed geometry
* [fix building position exceeds length](https://github.com/3DStreet/3dstreet/pull/208)
* lane marking proportions for non-default street lengths

Many more things before we started proper documentation...

## 0.3.2

## 0.3.1

## 0.2.15

## 0.2.14

## 0.2.13

## 0.2.12

## 0.2.11

## 0.2.10

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

## 0.1.1

## 0.1.0
