
# Streetmix3D
### Try in your browser now: https://kfarr.github.io/streetmix3d/

Streetmix3D creates 3D visualizations of your 2D [Streetmix.net](https://streetmix.net) streets using A-Frame and WebXR.

<img src="https://raw.githubusercontent.com/kfarr/streetmix3d/master/assets/streetmix3d.jpg" />

### How to make your own Streetmix3D street:
* First, use <a href="https://streetmix.net">Streetmix.net</a> to create a street design. (Streetmix is a tool that lets you design, remix, and share your neighborhood street. <a href="https://github.com/streetmix/streetmix/blob/master/README.md#about">More information about Streetmix here</a>.)
* Then, save a Streetmix street using a Twitter account so that you have a unique URL for your street that looks something like this: `https://streetmix.net/kfarr/3/my-awesome-street-name`
* Load https://kfarr.github.io/streetmix3d/, paste in your street URL, and press the magic green button.
* See instant changes to your work: Switch back to a Streetmix.net tab, make changes to your street, then reload the Streetmix3D page to see the edits applied.

### Streetmix Segment Support

Streetmix3D does not yet support all of the street `segments` found in Streetmix. You may find some segments don't display at all or are missing 3D elements. Here is a complete list:

| [Streetmix Segment](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.json)              | Streetmix3D Support? | Supported Variants  | Notes and Model Source |
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

### Streetmix Building Support

"Buildings" are lots and/or objects rendered on either side of the street to add to the setting.

| [Streetmix Building](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/buildings.js)              | Streetmix3D Support? | Supported Variants  | Notes |
| ---------------------------- | --------- | ------ | ----- |
| grass            | Yes       |     |  |
| fence       | Yes       | |  Fence Model: Paid Royalty Free License [CGTrader.com T&Cs Paragraph 21](https://www.cgtrader.com/pages/terms-and-conditions) for [construction fence Low-poly 3D model](https://www.cgtrader.com/3d-models/exterior/street/construction-fence-f8cc10f2-cf56-4f1d-a87a-c60c41d50b02) |
| parking-lot           | Yes | |    |
  | waterfront          | Yes | | Credit to [@Lady_Ada_King](https://twitter.com/Lady_Ada_King) for a-ocean-plane; @threejs for water normal jpeg; [cgskies](https://www.cgskies.com/) for sky image (paid [license](https://www.cgskies.com/about_legal.php)). Seawall Models: License [Sketchfab "Standard"](https://sketchfab.com/licenses) from [Polygon City Pack](https://sketchfab.com/3d-models/polygon-city-pack-preview-5a16f543d1054fbc9ce1cb17a2ba412e) |
| residential          | No | | |
| narrow          | Yes - partial | | Buildings: License [Sketchfab "Standard"](https://sketchfab.com/licenses) from [Polygon City Pack](https://sketchfab.com/3d-models/polygon-city-pack-preview-5a16f543d1054fbc9ce1cb17a2ba412e). Does not support varying floors as specified by Streetmix JSON. |
| wide          | Yes - partial | | Same as narrow. In the future this could include back alleyway, backyards, etc. |

### Helpful Streetmix debugging information
Here are some tips and links from my experience "reverse engineering" Streetmix to get info out of their API.

I heavily referenced this Streetmix page which outlines all the possible segments:
https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.json

I learned a few things:
* Each street has a unique UUID (such as `7a633310-e598-11e6-80db-ebe3de713876`) with its own corresponding API endpoint (such as https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876)
* This UUID is not shown in the UI. It can be found by going to this URL and supplying the nameSpacedId and creatorId, such as: https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr . This will redirect to the UUID API endpoint
* I wrote a quick JS helper function that takes a user facing URL on Streetmix (such as https://streetmix.net/kfarr/3/a-frame-city-builder-street-only) and transforms it into the API Redirect to find the UUID endpoint. You can find the [helper function docs here](https://github.com/kfarr/streetmix3d/tree/master/src#streetmix-utilsjs).

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
* Ambient SF https://www.soundsnap.com/ssl_16_11_amb_ext_afternoon_alamo_square_painted_houses_park_with_birds_some_people_around_calm_city_san_francisco_st_wav
* Diesel idling bus https://www.soundsnap.com/turbodiesel_bus_riding_and_idling

<img src="https://raw.githubusercontent.com/kfarr/streetmix3d/master/assets/streetmix3d-banner.jpg" />

### More Notes
See [DEV-NOTES](/DEV-NOTES.md) for additional notes on future features and work in progress.
