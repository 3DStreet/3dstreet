
## Bugs / missing features

B1 - Double-click logic improvements (phase 4)
B2 - Plan view should be a button, not a mode selection. Possibly combine with a compass indicator/control, like in Google Maps.  Needs design input, D1
B3 - Visible signal to the user when they are inside / outside a finite scene boundary.  Needs design input, D2.
B4 - Height for swoop zoom is controlled by y co-ordinate. Should be mesured above street level (for scenes where street level is not y=0)
B5 - FOV zoom lost on teleport
B6 - Should be able to transition between rotate and truck while dragging (Shift state should not latch on mouse-down)
B7 - "Zoom smoothness issues" (needs clarifiying)
B8 - "In rare cases zooming out from street-view to "top-down" mode results in unexpected camera location" - needs clarifying

## Code tasks

C1 - Review overall code for quality & consistency with existing codebase.
C2 - Use THREE.OrbitControls or custom code?  (current implementation used custom orbit code; TBC if there are good reasons not to use THREE.OrbitControls)


## Scope questions

S1 - FPS / Pointer lock mode?
S2 - Custom rotation center point (set by user)
S3 - Orthogrphic mode: retained or retired?
S4 - Migration of existing users: UI toggle to keep old controls?


## Design questions

D1 - Design for plan view / compass button
D2 - Design for indicator when user is inside/outside finite scene boundary
D3 - Design for rotation center indicator
D4 - Starting FOV when landing on ground: should it be wider?
D5 - UX for setting rotation center point (if S2 is in-scope)
D6 - Restrictions on "Streetview" mode above a certain elevation
D7 - Indicator for "Streetview" mode: letterbox OK, or something else?
D8 - Names for different modes "Maps" / "Streetview" ??
D9 - Momentum pattern for WASD controls
D10 - Remap of WASD key pre-existing functions.  So far, I picked
  - W → T (translate mode)
  - S → L (scale mode)
  - D → C (clone)

## Codebase questions

Q1 - Tests alongside code, or in top-level tests folder. README says the former, codebase actually does the latter.  Align?
Q2 - Dev Experience issues on Windows: rolldown and husky.  Fix these?


## Other tasks

O1 - User testing.  At what stage?  Early or late?  Could provide significant feedback on entire direction, so soon is good.  But prototype needs to be "good enough".
O2 - Video demo
O3 - docs updates
O4 - Deeper UX testing of the final implementation



