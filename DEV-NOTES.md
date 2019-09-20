
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




orbit-to-cam-position

Show
POSITION-ROTATION.md
Connected
aframe.scene.camera.getposition,zoom,rotation camEl = scene. AFRAME.scenes[0].camera.position AFRAME.scenes[0].camera.quaternion

AFRAME.scenes[0].camera.zoom remove attribute orbit-controls manually set camera position and rotation change rotation to euler convenience copy pasta for set 1 json with both

then animate the container around the camera broadcast component

var helperQuaternionSend = new THREE.Quaternion(); helperQuaternionSend.copy(el.object3D.quaternion);

document.getElementById("camera").getAttribute("orbit-controls", "enabled") document.getElementById("camera").setAttribute("orbit-controls", "enabled", "false") document.getElementById("camera").setAttribute("orbit-controls", "enabled", "true")

var jsonfun = {"position": AFRAME.scenes[0].camera.position, "quaternion": AFRAME.scenes[0].camera.quaternion} var jsonfun2 = {"position": AFRAME.scenes[0].camera.position, "quaternion": AFRAME.scenes[0].camera.quaternion}

AFRAME.scenes[0].camera.position = jsonfun["position"] // doesn't seem to work brah

AFRAME.scenes[0].camera.el. AFRAME.scenes[0].camera.position.copy(jsonfun2["position"])

AFRAME.scenes[0].camera.el.getObject3D('camera').position.set(0, 0, 0); //works!

AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: object3D.position.y; from: 1; to: 3")

AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: object3D.position.y; from: 0; to: 1")

AFRAME.scenes[0].camera.el.getObject3D('camera').position.set(0, 10, -4); //works! AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: object3D.position.x; from: 100; to: 0; easing: easeOutSine; dur: 2000;")

AFRAME.scenes[0].camera.el.getObject3D('camera').position.set(0, 10, -4); //works! AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: object3D.position; from: 100 10 -4; to: 0 10 -4; easing: easeOutSine; dur: 2000;")

AFRAME.scenes[0].camera.el.setAttribute("animation__1", "property: position; from: 0 10 -2; to: 0 1 5; easing: easeOutSine; dur: 2000;")
