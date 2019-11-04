file guide
index.html -> 3d rendering of streetmix segments using low poly voxel graphics
index-slide.html -> prototype oct 2019 for slide presentation changing viewpoints and perspective
index-texture.html -> work in progress to provide better visual fidelity 3d rendering


### Some notes on dimensions

Each segment "type" is a separate model. The models are created using MagicaVoxel. Normally a MagicaVoxel voxel = 1 meter in A-Frame by default, however for this project each voxel represents 1 decimeter (1/10th of a meter). The app reduces the size of the model (scale * 0.1) to compensate.

Default model widths:
* bike-lane 1.8m (18 voxel units)
* drive-lane 3m (30 voxel units)
* divider 0.3m (3 voxel units) (double yellow lines)
* parking-lane 2.4m (24 voxel units)


### Harrison Street Segment size notes
15 sidewalk1
8 parking
5 bike lane
10'6" drive lane1
10 drive lane 2
11 drive lane 3
5 bike lane 2
8 parking2
10 sidewalk2

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
