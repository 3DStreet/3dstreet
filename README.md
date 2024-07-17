
# 3DStreet
[![Version](http://img.shields.io/npm/v/3dstreet.svg)](https://npmjs.org/package/3dstreet)
[![License](http://img.shields.io/npm/l/3dstreet.svg)](LICENSE)
![Build Status](https://github.com/3DStreet/3dstreet/actions/workflows/ci-script.yaml/badge.svg)

3DStreet creates 3D visualizations of your 2D [Streetmix.net](https://streetmix.net) streets using A-Frame and WebXR. Developers can use the same core [`street` A-Frame component](#a-frame-street-component-api) of 3DStreet for their own projects.

### Online Tool

|[Start 3DStreet](https://3dstreet.app/)|
|---|

_(or visit https://3dstreet.app)_

<img height="500" src="https://raw.githubusercontent.com/kfarr/streetmix3d/master/ui_assets/streetmix3d.jpg" />

### [Quick Start - How to make your own 3DStreet scene from Streetmix. See documentation here.](https://www.3dstreet.org/docs/category/tutorial-use-streetmix-to-create-a-3dstreet-scene)

## The rest of this README is for developers. [User-facing docs are here.](https://www.3dstreet.org/docs/)

This repo is the 3DStreet Core Viewer. It provides parsing of JSON in Streetmix format into a 3DStreet scene. It also provides all of the core components needed for viewers. It is also a core dependency of the [3DStreet Editor hosted in a separate repository](https://github.com/3DStreet/3dstreet-editor).

### Project Hosting Path
This repo's main branch is hosted via github pages at `github.3dstreet.org`. The 3DStreet Editor uses this path to fetch 3DStreet dependencies. A-Frame developers leveraging 3DStreet Core will also use this path.

## A-Frame component
3DStreet is built upon a custom A-Frame `street` component which is also available for you to customize for your own custom A-Frame street scenes. The `street` component takes a string of JSON and renders one or more "segments" (also known as lanes or slices) of a street and optionally buildings and ground to the left and right.
### Usage Example

[![Remix](https://cloud.githubusercontent.com/assets/674727/24572421/688f7fc0-162d-11e7-8a35-b02bc050c043.jpg)](https://glitch.com/~3dstreet-simple) 

```html
<html>
  <head>
    <title>Street Component!</title>
    <script src="https://aframe.io/releases/1.5.0/aframe.min.js"></script>
    <script src="https://unpkg.com/3dstreet@0.4.5/dist/aframe-street-component.js"></script>
  </head>  
  <body>
    <a-scene>
      <a-entity id="mySimpleStreet" street streetmix-loader="streetmixStreetURL: https://streetmix.net/kfarr/3/" ></a-entity>
    </a-scene>
  </body>
</html>
```

### A-Frame `street` Component API

The `street` component creates a street made up of one or more segments as children of the entity it's attached to. It may also create buildings, ground, and place models in the scene using mixins. Creating the JSON array of segments by hand is cumbersome and typically the `streetmix-loader` component (below) is also used on the same entity to populate the street JSON from a Streetmix.net street.

| Property | Description | Default Value |
| --------- | --------- | --------- |
| JSON | A string of JSON containing an array one or more segments (also known as slices) representing cross-section parts of a street. See [basic-json.html](/examples/basic-json.html) for an example of proper usage | '' |
| type | A string representing the formatting of the JSON passed in the `JSON` property |  'streetmixSegmentsFeet' |
| left | A string to determine which [building variant](#list-of-streetmix-building-variants) to create for the left side of the street (heading outbound) | '' |
| right | A string to determine which building variant to create for the right side of the street (heading outbound). | '' |
| showGround | A boolean to determine if the ground associated with the specified building variant(s) in `left` and `right` should be created or not. | true |
| showStriping | A boolean to determine if the lane stripings should be created or not. | true |
| length | A number that sets the street's length in meters | 150 |

### A-Frame `intersection` Component API

The `intersection` component creates an intersection surface with options for adding curbs, sidewalks, crosswalks, stop signs, and traffic signals.

| Property | Description | Default Value |
| --------- | --------- | --------- |
| dimensions | Specifies the width and depth of the intersection. First value represents width, second value represents depth. | '20 20' |
| sidewalk | Sets the width of the sidewalk at each side of the intersection. Values are set in the order of west, east, north, south. |  '0 0 0 0' |
| northeastcurb | Sets the curb dimensions for the north east curb. Values are updated as width, then depth. | '4 4' |
| southwestcurb | Sets the curb dimensions for the south west curb. Values are updated as width, then depth.  | '4 4' |
| southeastcurb | Sets the curb dimensions for the south east curb. Values are updated as width, then depth. | '4 4' |
| northwestcurb | Sets the curb dimensions for the north west curb. Values are updated as width, then depth. | '4 4' |
| stopsign | Sets if each side of the intersection has a stop sign. Values are set in the order of east, west, north, south. 0 is false, 1 is true. | '0 0 0 0' |
| trafficsignal | Sets if each side of the intersection has a traffic signal. Values are set in the order of east, west, north, south. 0 is false, 1 is true. | '1 1 1 1' |
| crosswalk | ​​Sets if each side of the intersection has a crosswalk. Values are set in the order of east, west, north, south. 0 is false, 1 is true. | '1 1 1 1' |

### A-Frame `streetmix-loader` Component API

The `streetmix-loader` component requests a Streetmix API response when given a unique street URL and then passes the segments array JSON as a string to the `street` component (which is a dependency -- you must have the `street` component on the same entity as that of the `streetmix-loader` component). 

| Property | Description | Default Value |
| --------- | --------- | --------- |
| streetmixStreetURL | A string representing a "user facing" Streetmix street URL such as https://streetmix.net/kfarr/3/ | '' |
| streetmixAPIURL | A string representing the Streetmix API street URL such as https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876 | '' |
| showBuildings | A Boolean that determines whether or not buildings are rendered | true |

Either 1 of the 2 properties are required. If both are provided the component will use streetmixAPIURL value and ignore streetmixStreetURL.





#### Orientation and Scale
A default Streetmix.net cross-section view is oriented to show vehicles heading away from you as "outbound". The `street` component follows this convention and when placed in a new A-Frame scene the default camera is looking toward the outbound direction of the generated street. The default rendering is 1:1 scale.

#### Automatic Asset Loading
When `aframe-street-component.js` is included on a page it automatically loads 3D models and other assets using the A-Frame asset loader by adding them to the scene's `a-assets` block and defining mixins pointing to these assets. The `street` component itself simply places entities with appropriate mixin names. [For more information on the asset loader see this docs link](https://github.com/3DStreet/3dstreet/blob/main/src/README.md#assetsjs).

### Additional variant strings

- The word `animated` can be added to the variantString of the type `sidewalk` to make the pedestrians animated. Here is an example of how this can be implemented:
```
{
  "width": 9,
  "variantString": "normal|animated",
  "type": "sidewalk"
}
```
Please see `animated.html` for a demo.

### List of Supported Segment Types

3DStreet does not yet support all of the street `segments` found in Streetmix. You may find some segments don't display at all or are missing 3D elements. Here is a complete list:

| [Streetmix Segment Type](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.json)              | 3DStreet Support? | Variants  | Notes and Model Source |
| ---------------------------- | --------- | ------ | ----- |
| sidewalk            | Yes - Partial       | `empty`    | All variants show empty sidewalk, no pedestrian 3d models or density variants. |
| sidewalk-lamp       | Yes - All       | Variants: `right`, `left`, `both` Subvariants: `modern`, `traditional`, `pride`  | [Modern Lamp Post](https://poly.google.com/view/2DoFKofZE6H), License [Google Poly CC Attrib](https://support.google.com/poly/answer/7418679?hl=en); [Traditional Lamp Post](https://poly.google.com/view/ez9fM9NvtRB), License [Google Poly CC Attrib](https://support.google.com/poly/answer/7418679?hl=en) |
| bike-lane           | Yes - All | Variants: `regular`, `red`, `green` | No bikes shown   |
| drive-lane          | Yes - Partial | `car-type`: "car" and "sharrow" | Not supported: `car-type` truck and autonomous vehicle |
| turn-lane           | Yes - All        | `left` `right` `left-right-straight` `shared` `both` `left-straight` `right-straight` `straight` | Note: there appears to be a bug with Streetmix.net rendering of `turn-lane-orientation` variant in street cross section for `inbound` - it appears to be inverted from the street's json database value. https://github.com/streetmix/streetmix/issues/683. Note: Shared turn lane does not exhibit proper segment lane markings. |
| bus-lane            | Yes - Partial        |  `shared` (sharrow) variant not supported | Model Credits: [New Flyer XD40 Bus](https://sketchfab.com/3d-models/new-flyer-xd40-d61e475543324d21aa24b2b208fbf3c5) |
| divider             | Yes - Partial   | `striped-buffer`, `bollard` | striped-buffer is rendered for all variants. Original model credit: [Flexi Guide 300 Safe Hit Post](https://3dwarehouse.sketchup.com/model/e395a74c-03f9-411e-a8fe-3664c89c6c5d/Flexi-Guide-300-Safe-Hit-Post) |
| parking-lane        | Yes - Partial |       | `parking-lane-direction` and `parking-lane-orientation` unsupported, parking delimiter markings unsupported |
| sidewalk-tree       | Yes - All        | `palm-tree`, `big`  | Supports palm tree and normal ("big") street tree. Palm Tree: License [Google Poly CC Attrib](https://support.google.com/poly/answer/7418679?hl=en), [Model Source](https://poly.google.com/view/3vvQFrjtYWb), Street Tree: License [Sketchfab "Standard"](https://sketchfab.com/licenses), [Polygon City Pack](https://sketchfab.com/3d-models/polygon-city-pack-preview-5a16f543d1054fbc9ce1cb17a2ba412e)  |
| sidewalk-bench      | Yes - Partial        | `left`, `right` | "center" bench not supported.  |
| sidewalk-bike-rack  | Yes - Partial        |   |  Doesn't support height -- always at sidewalk level. No bike model yet, just the rack. Model credits: [Bike Rack by illustrationlogic](https://sketchfab.com/3d-models/bike-rack-c4aae071cc2543eeb98bcf1a76be40e4), License [CC BY NC SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) |
| sidewalk-wayfinding | Yes - Partial   | `small`, `medium`, `large` variants all render same object  | All size variants render the same simple wayfinding obelisk shape with texture based on original NYC [design from Pentagram.](https://www.pentagram.com/work/walknyc). |
| parklet             | No        |   |   |
| light-rail          | Yes - All        | `grass` variant displays as green color asphalt  |  Model credits: [Siemens Avenio](https://sketchfab.com/3d-models/siemens-avenio-for-cities-skylines-7e3d9f90af9447dabcb813a4af43ae76), License [CC BY NC SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/); [Train track 2 black](https://poly.google.com/view/0LrARHcOWtE), License [Google Poly CC BY](https://support.google.com/poly/answer/7418679?hl=en) |
| streetcar           | Yes - All        | `grass` variant displays as green color asphalt  | Model credit: [Godarville Tram](https://www.turbosquid.com/FullPreview/Index.cfm/ID/1015103), License [Turbo Squid Royalty Free](https://blog.turbosquid.com/royalty-free-license/) |
| transit-shelter     | Yes - Partial        | |  Doesn't support height -- always at sidewalk level.  |
| train               | No        |        |  No support planned, not a public Streetmix segment type. |
| scooter | Yes - All | Variants: `regular`, `red`, `green` | No scooters shown. (Treated identically to a bike lane.)  |
| scooter-drop-zone | No |||
| bikeshare | Yes | `left` `right`| Rendered every 100 meters. [Original model credit](https://3dwarehouse.sketchup.com/model/8fd9d5c603e1d5d0ebab176c393922a3/Bikeshare-Station) |
| food-truck | No |||
| flex-zone | No |||
| flex-zone-curb | No |||

### List of Building Variants

"Buildings" are lots and/or objects rendered on either side of the street to add to the setting.

| [Streetmix Building Variants](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/buildings.js)              | 3DStreet Support? | Notes |
| ---------------------------- | --------- | ------ |
| grass            | Yes       |  https://www.textures.com/download/grass0052/12094 |
| fence       | Yes       | Fence Model: Paid Royalty Free License [CGTrader.com T&Cs Paragraph 21](https://www.cgtrader.com/pages/terms-and-conditions) for [construction fence Low-poly 3D model](https://www.cgtrader.com/3d-models/exterior/street/construction-fence-f8cc10f2-cf56-4f1d-a87a-c60c41d50b02) |
| parking-lot           | Yes | https://www.textures.com/download/roads0111/53096  |
  | waterfront          | Yes | Credit to [@Lady_Ada_King](https://twitter.com/Lady_Ada_King) for a-ocean-plane; @threejs for water normal jpeg; [cgskies](https://www.cgskies.com/) for sky image (paid [license](https://www.cgskies.com/about_legal.php)). Seawall Models: License [Sketchfab "Standard"](https://sketchfab.com/licenses) from [Polygon City Pack](https://sketchfab.com/3d-models/polygon-city-pack-preview-5a16f543d1054fbc9ce1cb17a2ba412e) |
| residential          | Yes | Buildings: License [Synty Store EULA](https://syntystore.com/pages/end-user-licence-agreement) from [Polygon Town Pack](https://syntystore.com/products/polygon-town-pack). Does not support varying floors as specified by Streetmix JSON. |
| narrow          | Yes - partial | | Buildings: License [Sketchfab "Standard"](https://sketchfab.com/licenses) from [Polygon City Pack](https://sketchfab.com/3d-models/polygon-city-pack-preview-5a16f543d1054fbc9ce1cb17a2ba412e). Does not support varying floors as specified by Streetmix JSON. |
| wide          | Yes - partial | | Same as narrow. In the future this could include back alleyway, backyards, etc. ; https://www.textures.com/download/asphaltdamaged0057/46489|

### License
The 3DStreet codebase is offered under the GNU Affero General Public License v3, as specified in [the LICENSE file](LICENSE).

Assets such as 3D models, textures, and audio are offered under the [Creative Commons By Attribution Non-Commercial License](https://creativecommons.org/licenses/by-nc/4.0/), unless a more specific license is specified for each asset in the documentation on this page.

Contact [kieran@3dstreet.org](mailto:kieran@3dstreet.org) for commercial licensing.

### Developer Docs
See [this link for more information](src/README.md) about the custom components developed and modified for the project.

### Model Credits
* [Creative Commons Google Poly](https://support.google.com/poly/answer/7418679?hl=en)
* Some city / car models https://sketchfab.com/3d-models/polygon-city-pack-preview-5a16f543d1054fbc9ce1cb17a2ba412e
* Some road textures https://www.textures.com/download/roads0086/44877 https://www.textures.com/download/roads0122/55065
* Sidewalk textures https://www.textures.com/download/floorsregular0299/87153 https://www.textures.com/download/floorsregular0301/87158
* Fence model https://sketchfab.com/3d-models/chainlink-fence-low-poly-50901b0cc91b4e04a18ecd13bc379a90
* Bus stop, creative commons https://poly.google.com/view/7iBPwMlmfge
* Do something with this adorable train: https://sketchfab.com/3d-models/tram-and-rails-modular-4168da5a8b884171b4540dd33eb05ef2
* Trolley: https://sketchfab.com/3d-models/neighborhood-trolley-3bc683cca6b84d8985cc0befe710b8fa

### Audio Credits
* wide, narrow urban building variants: Ambient SF https://www.soundsnap.com/ssl_16_11_amb_ext_afternoon_alamo_square_painted_houses_park_with_birds_some_people_around_calm_city_san_francisco_st_wav
* fence, grass variants - AMB_Suburbs_Afternoon_Woods_Spring_Small Field_Bird Chirps_Low Car Rumbles_Grass_Leaves Rustle_ST_MKH8050-30.mp3
* parking-lot variant - "Parking lot ambience - long - looping.mp3" https://www.soundsnap.com/parking_lot_ambience_long_looping_wav
* waterfront variant - UKdock4.mp3 - https://www.soundsnap.com/ukdock4
* waterfront variant - Water pier underneath small waves distant traffic ambience_BLASTWAVEFX_31752.mp3 - https://www.soundsnap.com/node/96455
* residential (suburban) variant - lawn mower, etc. - AMB_Suburbs_Spring_Day_Distant Lawnmowers_Birds_Distant Traffic_Distant Plastic Windmill Spin_Truck Pass By_Plane Overhead_MS_ST_MKH8050-30.mp3  https://www.soundsnap.com/amb_suburbs_spring_day_distant_lawnmowers_birds_distant_traffic_distant_plastic_windmill_spin_truck_pass_by_plane_overhead_ms_st 
* Diesel idling bus https://www.soundsnap.com/turbodiesel_bus_riding_and_idling
* Tram pass https://www.soundsnap.com/tram_pass_by_fast_wav
* Historic streetcar pass https://www.soundsnap.com/streetcar_passing_by_smoothly

### Skybox credits
* Most skybox images (c) Polyhaven CC0 license polyhaven.com [individual credits](https://github.com/3DStreet/3dstreet/issues/360#issue-1910580549)

<img src="https://raw.githubusercontent.com/kfarr/3dstreet/master/ui_assets/streetmix3d-banner.jpg" />
