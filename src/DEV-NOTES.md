# DEV NOTES

These is a place to save random notes like code snippets, links to assets, and other references. This doc might not be useful to anyone else :)

### Audio Notes
```
var entity = document.querySelector('.playme');
entity.components.sound.playSound();
```

https://stackoverflow.com/questions/57285828/a-frame-mute-all-sound-including-sound-component-on-button-click

### Useful tools
https://glb-packer.glitch.me/ (combining gltf, glb, and textures)
gltf pack (optimizing meshes): https://github.com/zeux/meshoptimizer/tree/master/gltf

### PBR Texture Helpful notes:
https://docs.blender.org/manual/en/2.80/addons/io_scene_gltf2.html
https://forum.substance3d.com/index.php?topic=3243.0
https://cgaxis.com/

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

### Some notes on dimensions

Default segment widths:
* bike-lane 1.8m
* drive-lane 3m
* divider 0.3m
* parking-lane 2.4m

### 15th and Harrison Street Segment size notes
15 sidewalk1
8 parking
5 bike lane
10'6" drive lane1
10 drive lane 2
11 drive lane 3
5 bike lane 2
8 parking2
10 sidewalk2

Sources:
https://striping.sfmta.com/drawings/H_Streets/Harrison%20St/Harrison%20st_str-8160.2%20(20th%20st%20to%2015th%20st).pdf
https://www.sfmta.com/reports/striping-drawings

### Camera notes
https://glitch.com/edit/#!/orbit-to-cam-position?path=POSITION-ROTATION.md:46:0

https://stackoverflow.com/questions/29586422/three-js-ignore-parents-rotation
https://stackoverflow.com/questions/15181351/keep-object-rotation-based-on-parent-other-object-coordinate-system-in-three-js

orbit-to-cam-position

Show
POSITION-ROTATION.md
Connected
aframe.scene.camera.getposition,zoom,rotation camEl = scene. AFRAME.scenes[0].camera.position AFRAME.scenes[0].camera.quaternion


### Animation notes (not used)

AFRAME.scenes[0].camera.zoom remove attribute orbit-controls manually set camera position and rotation change rotation to euler convenience copy pasta for set 1 json with both

then animate the container around the camera broadcast component

var helperQuaternionSend = new THREE.Quaternion(); helperQuaternionSend.copy(el.object3D.quaternion);

document.getElementById("camera").getAttribute("orbit-controls", "enabled") document.getElementById("camera").setAttribute("orbit-controls", "enabled", "false") document.getElementById("camera").setAttribute("orbit-controls", "enabled", "true")

var jsonfun = {"position": AFRAME.scenes[0].camera.position, "quaternion": AFRAME.scenes[0].camera.quaternion}


AFRAME.scenes[0].camera.position = jsonfun["position"] // doesn't seem to work brah

AFRAME.scenes[0].camera.el. AFRAME.scenes[0].camera.position.copy(jsonfun2["position"])

AFRAME.scenes[0].camera.el.getObject3D('camera').position.set(0, 0, 0); //works!

AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: object3D.position.y; from: 1; to: 3")

AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: object3D.position.y; from: 0; to: 1")

AFRAME.scenes[0].camera.el.getObject3D('camera').position.set(0, 10, -4); //works! AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: object3D.position.x; from: 100; to: 0; easing: easeOutSine; dur: 2000;")

AFRAME.scenes[0].camera.el.getObject3D('camera').position.set(0, 10, -4); //works! AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: object3D.position; from: 100 10 -4; to: 0 10 -4; easing: easeOutSine; dur: 2000;")

AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: position; from: 0 10 -2; to: 0 1 5; easing: easeOutSine; dur: 2000;")

AFRAME.scenes[0].camera.rotation // returns euler in radians
To convert: rotation in RAD / (Math.PI/180)

To get camera ROTATION as string in degrees:
var rotationString = AFRAME.scenes[0].camera.rotation.x / (Math.PI/180) + " " + AFRAME.scenes[0].camera.rotation.y / (Math.PI/180)  + " " + AFRAME.scenes[0].camera.rotation.z / (Math.PI/180)

var jsonfun2 = {"position": AFRAME.scenes[0].camera.position.x + " " + AFRAME.scenes[0].camera.position.y + " " + AFRAME.scenes[0].camera.position.z, "rotation": AFRAME.scenes[0].camera.rotation.x / (Math.PI/180) + " " + AFRAME.scenes[0].camera.rotation.y / (Math.PI/180)  + " " + AFRAME.scenes[0].camera.rotation.z / (Math.PI/180) }
**********************************

Neighborhood Welcome
- sky view, looking north - 2d map
large: Mission District
small: San Francisco, CA
AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: position; from: 0 400 -2; to: 0.5 250 1; easing: easeOutSine; dur: 5000;")

fade in 3d model and 3d road or voxel road?

large: Harrison St
small: 15th to Alameda St
AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: position; from: 0.5 250 1; to: -42.634 12.735 -13.256; easing: easeInOutSine; dur: 5000;")

// RETURN
AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: position; to: 0.5 250 1; from: -42.634 12.735 -13.256; easing: easeInOutSine; dur: 5000;")

large: Current Conditions
small: September 2019
AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: position; to: -0.1 43 -7; from: -42.634 12.735 -13.256; easing: easeInOutSine; dur: 5000;")

fade out 3d model
AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: position; from: -0.1 43 -7; to: -0.1 23 -7; easing: easeInOutSine; dur: 5000;")

small: Transit First Score
large: 40% (red color)

Top Down (outbound) view
Labels (voxel view)
Width Overall
Width for each segment
2d overlay of streetmix2d

Transit Score: 40% (red)
score = width of transit segments / total width of street
transit = anything but drive lane and parking

//FADE TO BLACK

Alt1 Parking Protected Inbound
Alt2 Parking Protected Outbound

Transit Score: 50% (yellow)



alternate2

alt2 primary feature
