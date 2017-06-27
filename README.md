# aframe-streetmix
Streetmix.net mixed with A-Frame for visualization of streetscapes

Demos:
* https://kfarr.github.io/aframe-streetmix/
* https://www.youtube.com/watch?v=89DxvLGa978

List of segments and variants in json file:
* https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.js

| [Streetmix Segment](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.js)              | Supported? | Supported Variants  | Unsupported Variants |
| ------------------- | --------- | ------ | ----- |
| sidewalk            | Yes - Full        |        | no pedestrian 3d models, density levels unsupported, uses empty sidewalk for all variants |
| sidewalk-tree       | no        |   | 3d object - palm 2 and 3   |
| sidewalk-bench      | no        |      | 3d object - bench 1, 2 and 3|
| sidewalk-bike-rack  | no        |     | 3d model needed |
| sidewalk-wayfinding | no        | | 3d model needed     |
| sidewalk-lamp       | no        | | 3d object - street light 1 and 2     |
| parklet             | no        | | 3d model needed     |
| divider             | Yes - Partial       | | only 1 texture (double yellow lines) does not match streetmix (dashed white lines), some 3d models needed for variants       |
| parking-lane        | Yes - Partial  |       | direction unsupported - "ticks" on both sides of lane |
| bike-lane           | Yes - Partial  | inbound, outbound | only green color supported       |
| drive-lane          | Yes - Full      | inbound, outbound, sharrow | No 3D car or truck models supported yet.        |
| turn-lane           | no        |        |
| bus-lane            | no        |        |
| light-rail          | no        |        |
| streetcar           | no        |        |
| transit-shelter     | no        | | 3d object bus stop     |
| train               | no        |        |  This does not appear to be enabled in Streetmix UI. Is this intended to be mixed mode or unpaved grade separated tracks? |

Model credits:
* Voxel street segments created by Kieran Farr, MIT License same as project repo
* Some 3D models created by vencreations, https://www.cgtrader.com/vencreations, ["Royalty Free" License](https://www.cgtrader.com/pages/terms-and-conditions#royalty-free-license)
