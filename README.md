
# 3DStreet
### Basic demo: http://3dstreet.co/

[![Version](http://img.shields.io/npm/v/3dstreet.svg?style=flat-square)](https://npmjs.org/package/3dstreet)
[![License](http://img.shields.io/npm/l/3dstreet.svg?style=flat-square)](https://npmjs.org/package/3dstreet)

3DStreet creates 3D visualizations of your 2D [Streetmix.net](https://streetmix.net) streets using A-Frame and WebXR. Developers can use the same core [`street` A-Frame component](#a-frame-street-component-api) of 3DStreet for their own projects.

<img src="https://raw.githubusercontent.com/kfarr/streetmix3d/master/assets/streetmix3d.jpg" />

### Quick Start - How to make your own 3D street:
* First, use <a href="https://streetmix.net">Streetmix.net</a> to create a street design. (Streetmix is a tool that lets you design, remix, and share your neighborhood street. <a href="https://github.com/streetmix/streetmix/blob/master/README.md#about">More information about Streetmix here</a>.)
* Then, save a Streetmix street after making an account to generate a unique URL for your street looking something like this: `https://streetmix.net/kfarr/3/my-awesome-street-name`
* Load https://kfarr.github.io/3dstreet/, paste in your street URL, and press enter or the refresh button.
* See your Streetmix street in 3D! See instant changes to your work: Switch back to a Streetmix.net tab, make changes to your street, then reload the 3DStreet page to see the edits applied.

### A-Frame `street` Component API
3DStreet is built upon a custom A-Frame `street` component which is also available for you to customize for your own custom A-Frame street scenes. The `street` component takes a string of JSON and renders one or more "segments" (also known as lanes or slices) of a street and optionally buildings and ground to the left and right.

| Property | Description | Default Value |
| --------- | --------- | --------- |
| JSON | A string of JSON containing an array one or more segments (also known as slices) representing cross-section parts of a street. See [basic-json.html](/examples/basic-json.html) for an example of proper usage | '' |
| type | A string representing the formatting of the JSON passed in the `JSON` property |  'streetmixSegmentsFeet' |
| left | A string to determine which [building variant](#list-of-streetmix-building-variants) to create for the left side of the street (heading outbound) | '' |
| right | A string to determine which building variant to create for the right side of the street (heading outbound). | '' |
| showGround | A boolean to determine if the ground associated with the specified building variant(s) in `left` and `right` should be created or not. | true |
| showStriping | A boolean to determine if the lane stripings should be created or not. | true |

#### Orientation and Scale
A default Streetmix.net cross-section view is oriented to show vehicles heading away from you as "outbound". The `street` component follows this convention and when placed in a new A-Frame scene the default camera is looking toward the outbound direction of the generated street. The default rendering is 1:1 scale.

### A-Frame `streetmix-loader` Component API
The `streetmix-loader` component requests a Streetmix API response when given a unique street URL and then passes the segments array JSON as a string to the `street` component (which is a dependency -- you must have the `street` component on the same entity as that of the `streetmix-loader` component). 

| Property | Description | Default Value |
| --------- | --------- | --------- |
| streetmixStreetURL | A string representing a "user facing" Streetmix street URL such as https://streetmix.net/kfarr/3/ | '' |
| streetmixAPIURL | A string representing the Streetmix API street URL such as https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876 | '' |

Either 1 of the 2 properties are required. If both are provided the component will use streetmixAPIURL value and ignore streetmixStreetURL.

| Property | Description | Default Value |
| --------- | --------- | --------- |
| JSON | A string of JSON containing an array one or more segments (also known as slices) representing cross-section parts of a street. See [basic-json.html](/examples/basic-json.html) for an example of proper usage | '' |
| type | A string representing the formatting of the JSON passed in the `JSON` property |  'streetmixSegmentsFeet' |
| left | A string to determine which [building variant](#list-of-streetmix-building-variants) to create for the left side of the street (heading outbound) | '' |
| right | A string to determine which building variant to create for the right side of the street (heading outbound). | '' |
| showGround | A boolean to determine if the ground associated with the specified building variant(s) in `left` and `right` should be created or not. | true |
| showStriping | A boolean to determine if the lane stripings should be created or not. | true |

### List of Streetmix Segment Types

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

### List of Streetmix Building Variants

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

### Helpful Streetmix debugging information
Here are some tips and links from my experience "reverse engineering" Streetmix to get info out of their API.

I heavily referenced this Streetmix page which outlines all the possible segments:
https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.json

I learned a few things:
* Each street has a unique UUID (such as `7a633310-e598-11e6-80db-ebe3de713876`) with its own corresponding API endpoint (such as https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876)
* This UUID is not shown in the UI. It can be found by going to this URL and supplying the nameSpacedId and creatorId, such as: https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr . This will redirect to the UUID API endpoint
* I wrote a quick JS helper function that takes a user facing URL on Streetmix (such as https://streetmix.net/kfarr/3/a-frame-city-builder-street-only) and transforms it into the API Redirect to find the UUID endpoint. You can find the [helper function docs here](https://github.com/kfarr/3dstreet/tree/master/src#streetmix-utilsjs).

### Developer Docs
See [this link for more information](src/README.md) about the custom components developed and modified for the project.

### Model Credits
* Unless credited all models, materials and textures created by Kieran Farr, MIT License same as project repo
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

<img src="https://raw.githubusercontent.com/kfarr/3dstreet/master/assets/streetmix3d-banner.jpg" />

### More Notes
See [DEV-NOTES](/DEV-NOTES.md) for additional notes on future features and work in progress.
