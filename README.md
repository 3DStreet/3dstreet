
# Streetmix3d
Streetmix.net mixed with A-Frame for visualization of streetscapes

### Demo in your browser now: https://kfarr.github.io/streetmix3d/

<img src="https://raw.githubusercontent.com/kfarr/streetmix3d/master/assets/streetmix3d.gif" />

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
| bike-lane           | Yes - Partial | | `bike-asphalt` color not supported, green used for all variants   |
| drive-lane          | Yes - Partial | `car-type`: "car" and "sharrow" | Not supported: `car-type` truck and autonomous vehicle |
| turn-lane           | Yes - Partial        | All except "shared" | Note: there appears to be a bug with Streetmix.net rendering of `turn-lane-orientation` variant in street cross section for `inbound` - it appears to be inverted from the street's json database value. https://github.com/streetmix/streetmix/issues/683 |
| bus-lane            | Yes - Partial        |   | `bus-asphalt` color not supported, default always red |
| divider             | Yes - Partial   | `divider-type`: striped-buffer is rendered for all variants |  |
| parking-lane        | Yes - Partial |       | `parking-lane-direction` and `parking-lane-orientation` unsupported, parking delimiter markings unsupported |
| sidewalk-tree       | Yes - All        | `palm-tree`, `big`  | Supports palm tree and normal ("big") street tree. Palm Tree: License [Google Poly CC Attrib](https://support.google.com/poly/answer/7418679?hl=en), [Model Source](https://poly.google.com/view/3vvQFrjtYWb), Street Tree: License [Sketchfab "Standard"](https://sketchfab.com/licenses), [Polygon City Pack](https://sketchfab.com/3d-models/polygon-city-pack-preview-5a16f543d1054fbc9ce1cb17a2ba412e)  |
| sidewalk-bench      | Yes - Partial        | `left`, `right` | "center" bench not supported.  |
| sidewalk-bike-rack  | No        |   |  Potential: https://sketchfab.com/3d-models/bike-rack-c4aae071cc2543eeb98bcf1a76be40e4 |
| sidewalk-wayfinding | No   |   |  |
| parklet             | No        |   |   |
| light-rail          | Yes - Partial        |   |  `public-transit-asphalt` not supported, default always red. Model credits: [Siemens Avenio](https://sketchfab.com/3d-models/siemens-avenio-for-cities-skylines-7e3d9f90af9447dabcb813a4af43ae76), License [CC BY NC SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/); [Train track 2 black](https://poly.google.com/view/0LrARHcOWtE), License [Google Poly CC BY](https://support.google.com/poly/answer/7418679?hl=en) |
| streetcar           | Yes - Partial        |   | `public-transit-asphalt` not supported, default always red. Model credit: [Godarville Tram](https://www.turbosquid.com/FullPreview/Index.cfm/ID/1015103), License [Turbo Squid Royalty Free](https://blog.turbosquid.com/royalty-free-license/) |
| transit-shelter     | Yes        | |  doesn't support height |
| train               | No        |        |  No support planned, not a public Streetmix segment type. |
| scooter | No ||
| scooter-drop-zone | No ||
| bikeshare | No ||
| food-truck | No ||
| flex-zone | No ||
| flex-zone-curb | No ||

### Streetmix Building Support

"Buildings" are lots and/or objects rendered on either side of the street to add to the setting.

| [Streetmix Building](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/buildings.js)              | Streetmix3D Support? | Supported Variants  | Notes |
| ---------------------------- | --------- | ------ | ----- |
| grass            | Yes       |     |  |
| fence       | Yes       | |   |
| parking-lot           | Yes | |    |
| waterfront          | No | | |
| residential          | No | | |
| narrow          | Yes | | Narrow and wide are the same thing |
| wide          | Yes | | Buildings: License [Sketchfab "Standard"](https://sketchfab.com/licenses) from [Polygon City Pack](https://sketchfab.com/3d-models/polygon-city-pack-preview-5a16f543d1054fbc9ce1cb17a2ba412e) |

### Helpful Streetmix debugging information
Here are some tips and links from my experience "reverse engineering" Streetmix to get info out of their API.

I heavily referenced this Streetmix page which outlines all the possible segments:
https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.json

I learned a few things:
* Each street has a unique UUID (such as `7a633310-e598-11e6-80db-ebe3de713876`) with its own corresponding API endpoint (such as https://streetmix.net/api/v1/streets/7a633310-e598-11e6-80db-ebe3de713876)
* This UUID is not shown in the UI. It can be found by going to this URL and supplying the nameSpacedId and creatorId, such as: https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr . This will redirect to the UUID API endpoint
* I wrote a quick JS helper function that takes a user facing URL on Streetmix (such as https://streetmix.net/kfarr/3/a-frame-city-builder-street-only) and transforms it into the API Redirect to find the UUID endpoint, it is here and the inverse function is a few lines below: https://github.com/kfarr/streetmix3d/blob/master/js/aframe-streetmix.js#L219

### Model Credits
* Unless credited all models, materials and textures created by Kieran Farr, MIT License same as project repo
* [Creative Commons Google Poly](https://support.google.com/poly/answer/7418679?hl=en)
* New Flyer XD40 Bus https://twitter.com/_TimTheTerrible
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

### Potential building models:
## House / Suburban Style
https://sketchfab.com/3d-models/residential-pack-part-1-4be6c94086bd476796e5568df6ca9ee7 <<-- this looks good
https://sketchfab.com/3d-models/residential-pack-part-2-0d8f8bf7b49046aeb54426dd70213bc2
https://sketchfab.com/3d-models/residential-pack-part-3-c5a2c6ed161447dab81d34c09fb2dc7a
https://sketchfab.com/3d-models/suburb-house-1-fbdd97651fff4a42b7d193f1b53bb8dd - low poly suburban
https://poly.google.com/view/75V_MLvKMqM - cartoon style
https://poly.google.com/view/cH1j7_BN9wx - bungalow rural
https://poly.google.com/view/6FQ_iKCIQd7 - apartment style, photogrammetry low poly
https://poly.google.com/view/2b2pH3CD9ad - photogrammetry low poly
https://poly.google.com/view/bQpvnFgH5wr - cartoon style
## Commercial
https://poly.google.com/view/cINomH54DAx - low poly photogrammetry suburban commercial
https://poly.google.com/view/2M7mM1xmEp1 - low poly photogrammetry urban PDR
### Vision
Animate this https://twitter.com/metrolosangeles/status/1153807208229957632
Animate this https://twitter.com/FouadUrbanist/status/1176890584935653380
Animate this https://twitter.com/NACTO/status/1189926384233259008
Or something like this! https://github.com/nagix/mini-tokyo-3d
Make this type of image interactive https://nacto.org/publication/urban-bikeway-design-guide/intersection-treatments/combined-bike-laneturn-lane/

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
Car driving reference code 1 https://github.com/spacejack/carphysics2d/blob/master/public/js/Car.js
Car driving reference code 2 https://github.com/chipbell4/car-physics/blob/master/app.js

### References
CA MUTCD 2014 Ch 3b Page 79-80, 88 https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/ca-mutcd/camutcd2014-chap3b-rev3-a11y.pdf
CA MUTCD 2014 Ch 9c 9C-3 Page 11 - https://dot.ca.gov/-/media/dot-media/programs/traffic-operations/documents/ca-mutcd/camutcd2014-chap9c-rev3-a11y.pdf
City of Lodi PWD https://www.lodi.gov/DocumentCenter/View/2519/710-Pavement-Marking-Details-PDF

### Potential collaborators
https://www.linkedin.com/in/arturoparacuellos/
https://www.linkedin.com/in/simonbruno77/
