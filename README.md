# aframe-streetmix
Streetmix.net mixed with A-Frame for visualization of streetscapes

Demos:
* https://kfarr.github.io/aframe-streetmix/
* https://www.youtube.com/watch?v=89DxvLGa978

List of segments and variants in json file:
* https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.js

| [Streetmix Segment](https://github.com/streetmix/streetmix/blob/master/assets/scripts/segments/info.js)              | Supported | Notes  |
| ------------------- | --------- | ------ |
| sidewalk            | no        |        |
| sidewalk-tree       | no        | 3d object - palm 2 and 3     |
| sidewalk-bench      | no        | 3d object - bench 1, 2 and 3     |
| sidewalk-bike-rack  | no        | 3d model needed    |
| sidewalk-wayfinding | no        | 3d model needed     |
| sidewalk-lamp       | no        | 3d object - street light 1 and 2     |
| parklet             | no        | 3d model needed     |
| divider             | yes       | only 1 texture (double yellow lines) does not match streetmix (dashed white lines), some 3d models needed for variants       |
| parking-lane        | yes       | "ticks" on both sides of lane       |
| bike-lane           | yes       | only 1 direction supported       |
| drive-lane          | yes       | no direction indicated        |
| turn-lane           | no        |        |
| bus-lane            | no        |        |
| streetcar           | no        |        |
| light-rail          | no        |        |
| streetcar           | no        |        |
| transit-shelter     | no        | 3d object bus stop     |
| train               | no        |        |
