
# Streetmix3d
Streetmix.net mixed with A-Frame for visualization of streetscapes

### Demo in your browser now: https://kfarr.github.io/streetmix3d/

<img src="https://raw.githubusercontent.com/kfarr/streetmix3d/master/assets/streetmix3d.gif" />

### How to make your own Streetmix3D street:
* First, use <a href="https://streetmix.net">Streetmix.net</a> to create a street design. (Streetmix is a tool that lets you design, remix, and share your neighborhood street. <a href="https://github.com/streetmix/streetmix/blob/master/README.md#about">More information about Streetmix here</a>.)
* Then, save a Streetmix street using a Twitter account so that you have a unique URL for your street that looks something like this: `https://streetmix.net/kfarr/3/my-awesome-street-name`
* Load https://kfarr.github.io/streetmix3d/, paste in your street URL, and press the magic green button.
* See instant changes to your work: Switch back to a Streetmix.net tab, make changes to your street, then reload the Streetmix3D page to see the edits applied.
* "Walk" around the scene or use VR: Use the <code>W A S D</code> keys to move around the 3D scene. You can even use a VR headset to see a 1:1 scale virtual view of your street with a <a href="https://webvr.rocks">WebVR compatible headset.</a>

### Streetmix Segment Support

Streetmix3D does not yet support all of the street `segments` found in Streetmix. You may find some segments don't display at all or are missing 3D elements. We'd gladly support any help making 3D models that match the designs from the original Streetmix. Here is a complete list:

| [Streetmix Segment](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.js)              | Supported? | Supported Variants  | Unsupported Variants |
| ---------------------------- | --------- | ------ | ----- |
| sidewalk            | Yes - Full        |        | no pedestrian 3d models, density levels unsupported, uses empty sidewalk for all variants |
| sidewalk-tree       | no        |   | 3d object - palm 2 and 3   |
| sidewalk-bench      | no        |      | 3d object - bench 1, 2 and 3|
| sidewalk-bike-rack  | no        |     | 3d model needed |
| sidewalk-wayfinding | Yes - Partial        | `medium` | known issue: one side has mirror texture, 3d model needed for `small` and `large` variants     |
| sidewalk-lamp       | no        | | 3d object - street light 1 and 2     |
| parklet             | no        | | 3d model needed     |
| divider             | Yes - Partial   | `divider-type`: striped-buffer, bollard | only 1 texture (double yellow lines) does not match streetmix (dashed white lines), some 3d models needed for variants       |
| parking-lane        | Yes - Partial  |       | `parking-lane-direction` and `parking-lane-orientation` unsupported - "ticks" on both sides of lane |
| bike-lane           | Yes - Partial  | `direction`: inbound, outbound | `bike-asphalt` not supported, only green color   |
| drive-lane          | Yes - Full      | `direction`: inbound, outbound \| `car-type`: sharrow | `car-type`: car, truck - No 3D car or truck models supported yet.        |
| turn-lane           | Yes - Full        | `direction`: inbound, outbound \| `turn-lane-orientation`: left, left-straight, right, right-straight, both, shared, straight       | Note: there appears to be a bug with Streetmix.net rendering of `turn-lane-orientation` variant in street cross section for `inbound` - it appears to be inverted from the street's json database value. https://github.com/streetmix/streetmix/issues/683 |
| bus-lane            | Yes - Partial        | `direction`: inbound, outbound       | `bus-asphalt` not supported default always red |
| light-rail          | Yes - Partial        | `direction`: inbound, outbound       | `public-transit-asphalt` not supported default always red |
| streetcar           | Yes - Partial        | `direction`: inbound, outbound       | `public-transit-asphalt` not supported default always red |
| transit-shelter     | no        | | 3d object bus stop     |
| train               | no        |        |  This does not appear to be enabled in Streetmix UI. Is this intended to be mixed mode or unpaved grade separated tracks? |

### Helpful Streetmix debugging information

Here are some tips and links from my experience "reverse engineering" Streetmix to get info out of their API.

I heavily referenced this Streetmix page which outlines all the possible segments:
https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.js

I learned a few things:
* Each street has a unique UUID (such as `7a633310-e598-11e6-80db-ebe3de713876`) with its own corresponding API endpoint (such as https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876)
* This UUID is not shown in the UI. It can be found by going to this URL and supplying the nameSpacedId and creatorId, such as: https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr . This will redirect to the UUID API endpoint
* I wrote a quick JS helper function that takes a user facing URL on Streetmix (such as https://streetmix.net/kfarr/3/a-frame-city-builder-street-only) and transforms it into the API Redirect to find the UUID endpoint, it is here and the inverse function is a few lines below: https://github.com/kfarr/streetmix3d/blob/master/aframe-streetmix.js#L219

### Model Credits
* Voxel street segments created by Kieran Farr, MIT License same as project repo
* Some 3D models created by vencreations, https://www.cgtrader.com/vencreations, ["Royalty Free" License](https://www.cgtrader.com/pages/terms-and-conditions#royalty-free-license)

<img src="https://raw.githubusercontent.com/kfarr/streetmix3d/master/assets/streetmix3d-banner.jpg" />

### Potential Backgrounds
https://www.flickr.com/photos/sitoo/48130422838/
https://www.flickr.com/photos/kanalu/40842804183/
https://www.flickr.com/photos/simonwaldherr/43292801800/
https://www.flickr.com/photos/sitoo/46891684951/
https://www.flickr.com/photos/165401243@N04/45103062855/
https://www.flickr.com/photos/170458314@N04/48375643091/in/pool-equirectangular/
https://www.hdri-skies-360.com/
http://www.philohome.com/skycollec/skycollec.htm
https://cdn.eso.org/images/large/eso0932a.jpg

### Vision
Animate this https://twitter.com/metrolosangeles/status/1153807208229957632

### Get buildings on block
https://www.instructables.com/id/Capture-3D-Models-From-Google-Maps-or-Earth/
https://www.autodesk.com/products/recap/overview

### Get other map snippets in your scene
https://github.com/w3reality/three-geo
A-Frame three-geo adapter from @bluepenguinvr https://glitch.com/edit/#!/threegeo-aframe?path=index.html:86:11
https://threegeo-aframe.glitch.me/

### Others
https://webkid.io/blog/3d-map-library-roundup/
cool example https://demo.f4map.com/#lat=55.7425832&lon=37.6501812&zoom=15&camera.theta=0.9
works but complicated code https://github.com/OSMBuildings/OSMBuildings
interesting but not quite suited for this project https://github.com/peterqliu/threebox
https://cesium.com/content/
