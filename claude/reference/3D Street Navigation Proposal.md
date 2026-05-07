# 3D Street Navigation Proposal

*!! Rough draft 22-4-2026, for discussion with Kieran*



## Conventions

**Tilt angle:** 0° = camera horizontal, 90° = camera straight down. The "30° threshold" referenced throughout is a gentle downward gaze — well above horizontal but well short of straight-down.

**Scene "bounded" vs "unbounded":** A scene is treated as **unbounded** if it contains a `street-geo` or `google-maps-aerial` entity (geo-located scenes are effectively infinite). Otherwise it is **bounded**. The bounds, when bounded, are computed as a vertical cylinder: center = the XZ center of the union AABB of all `managed-street`, `street` (legacy), and `intersection` entities; radius = the largest horizontal half-extent of that AABB. Bounds are cached and invalidated on entity add/remove/reposition.

## Camera movement terminology



| Term           | Axis / plane                | What moves                         | Notes                        |
| -------------- | --------------------------- | ---------------------------------- | ---------------------------- |
| Pedestal (ped) | Vertical (Y-axis translate) | Whole camera rises/lowers          | Direction unchanged          |
| Dolly (track)  | Forward/back (Z translate)  | Camera moves toward/away           | Also: dolly in / dolly out   |
| Truck (crab)   | Lateral (X-axis translate)  | Camera slides left/right           | Direction unchanged          |
| Pan            | Horizontal (Y-axis rotate)  | Camera rotates left/right          | Camera stays put             |
| Tilt           | Vertical (X-axis rotate)    | Camera pivots up/down              | Camera stays put             |
| Roll           | Z-axis rotate               | Camera rotates about the lens axis | Camera stays put             |
| Zoom           | Optical (focal length)      | Lens magnifies — camera still      | Not a true camera move<br /> |

## Overview /inspiration

Match Google Maps + Street View control system, but with improved flexibility:

- Allow tilt below 30 degrees, right down to street level
- Smoother transition between Birds-eye and Street views, so it feels like a single integrated system
- Double-click navigation building on existing 3D street system



## Plan / Bird eye view

When tilt is pointing downwards from 90 degrees up to 30 degrees, and we are not in proximity to the street scene - say 10m distant from any object, controls operate exactly like Google Maps.

Proposed changes from current implementation:

- "Plan view" is removed as a separate view.  This is just a particular camera angle of "Birds eye view".  It becomes a button that resets camera angle to a N-S oriented top-down view, via an **animated transition** (consistent with the smooth transitions used elsewhere; an instant cut would feel jarring).
- LB+mouse = truck/dolly.  Similar to existing controls.  However current implementation moves in the camera X & Y planes.  Switches to move in the world X & Z planes, to match Google Maps.
- Shift+LB+mouse = pan/tilt.  Similar to existing controls, but shifted from RB to Shift+LB to match Google Maps, and to free up RB for a contextual menu
- Mouse wheel = dolly along camera's Z axis.  Matches Google Maps.  Similar to current behaviour, but movement rate should be faster (Google Maps has a very sensitive zoom in/out), and **exponential** — each wheel tick changes camera distance by a fixed *percentage* rather than a fixed absolute amount. (Google Maps appears linear but is in fact exponential; a true linear zoom feels sluggish high up and runaway low down.)
- WASD keys as an alternative mechanism for truck/dolly. Movement is in the **horizontal plane**, with "forward" (W) projected from the camera's current yaw — i.e. W moves you in the direction the camera is facing, ignoring tilt. (When the camera is pointing straight down, "forward" follows the camera's local up direction projected to horizontal.) For consistency with closer views (see later).



## Key Novel Mechanics

Google Maps does not allow camera tilt angle below about 30 degrees - and for good reason as it creates some complexities:

- When you are looking forward, not down, LB+mouse = truck/dolly feels unnatural.  At some point you want this to switch to truck/pedestal (sideways and vertical)
- Center of rotation for pan/tilt becomes less obvious (explained in more detail later)

Additionally, on a close zoom, Google Maps offers a transition into "Street View", but the transition is not smooth or clean.  We'd like to be able to offer a much smoother and cleaner transition than this.



### Transition from Truck/Dolly to Truck/Pedestal

The current 3D Street LB+mouse controls move the camers on the camera's X/Y plane.

- When the camera faces straight down, LB+mouse moves the world horizontally (truck / dolly).  This matches Google Maps, and is great.
- When the camera faces straight forwards, LB+mouse moves the world sideways and vertically (truck / pedestal).  This is distinct from Google Maps (which doesn't offer tilt below 30 degrees), but it feels very natural ans sensible.

The issue is in between.  When the camera is tilted at a 45 degree angle, LB+mouse up results in the camera position moving both upwards and forwards at the same time.  This is not a natural movement, and feels disorienting.

While I am proposing blended transforms elsewhere (see next section), I don't think it works in this case.

In this case, I think it is better to have a clean cut-off (around 30 degrees tilt) between LB+mouse moving the world horizontally, and LB+mouse moving the camera in the vertical plane (with a visual indicator to show which of these modes the user is in)



### "Bounds-based" logic for rotation center

Allowing views with a low tilt angle (below 30 degrees) creates problems for the center of rotation used for pan / tilt.

- When the camera is pointing straight down, the center of rotation is obvious: it's the center of the screen, (normaly) at street level.  So pan/tilt behaviour always feels intuitive
- When the camers is pointing horizontally, the center of rotation is not obvious: it's directly forward of the camera, but at what depth?  There's little in the way of clear visual indicators.  Even with a visual indicator, the user may not recognize the significance of the market, or may have their own expectations based on the scene - e.g. for a bounded diorama, it's natural to expect it to rotate about its center.
- There is a further issue when the elevation of the camera above the scene becomes low enough that the camera is immersed within the scene content.  Then rotation about a distant point translates into rapid sideways motion for the camera, which is disorienting and cause camera collisions with vehicles, buildings etc. leading to clipping.

Proposed solution:

- 1. Above 30 degrees tilt (i.e. looking mostly downward), rotate about the center of the current camera view, at street level.  Same as existing function
- 2. Below 30 degrees tilt, when the scene is bounded (per definition above) and the camera sits outside the bounds cylinder, rotate about the center of the scene geometry ("diorama mode"). The cylindrical (rather than AABB) bounds avoid the "long narrow street" pathology where a camera 2m off the side of the street would otherwise rotate around a point 25m down the street.
- 3. Below 30 degrees tilt, when the scene is unbounded, or the camera lies within the bounds cylinder, rotate about the camera position.  This is the rotation model used in Google Street View.

**Latching:** The choice of rotation center is latched at gesture start (mouse-down) and held for the duration of the drag, to avoid mid-gesture jumps when the camera crosses the bounds boundary or the 30° threshold. A new gesture re-evaluates.

Transitons / Border regions

- To avoid abrupt transitions when tilting above/below 30 degrees,  use a weighted blend of the two rotation centers, between 20 and 30 degrees.
- In the zone around the edge of the scene bounds, where it's not really clear whether the camera is "in the scene" or "outside the scene", use a weighted blend of the two rotation centers.

How these weighted blends will feel remains to be seen.  On the one hand, they may be confusing as there's no clearly discernable point about which the view is rotating.  On the other hand, they may feel quite natural, given that they blend seamlessly, rather than giving the user an abrupt transition between two different movement mechanics.

For the blends to feel natural, it's important that the blended mechanics are not radically different from each othe, but that should be the case here.  Gradually moving the rotation center as the user tilts their view will hopefully feel like quite a natural transition.



### 3-phase "Swoop" zoom

This attempts to deliver a smooth, continuous, equivalent of the transitions in Google Maps between the birds-eye view and street view.

Mouse-wheel behaviour is split into 3 phases.

- Phase 1 (birds eye view) - Mouse wheel dollies the camera along the ray from the camera through the cursor's current world hit-point ("**cursor-anchored zoom**", matching Google Maps). The world point under the cursor stays under the cursor as the camera moves in. Tilt is preserved through the move. In plan view with the cursor at screen center, this degenerates to a straight-down dolly; with the cursor off-center, the camera also translates horizontally so the anchor point stays put.
- Phase 2 (transition) - At elevations between (maybe) 10m and 1.5m (eye level), mouse wheel turns into a combined pedestal up/down (like riding an elevator) and a camera tilt, so that by 1.5m, the camera is horizontal. **Cursor anchoring continues to apply** — the descent track aims to keep the anchor point under the cursor — which means the user naturally lands next to the world point they were aiming at, rather than stranded above or short of it.
- Phase 3 (focal zoom) - Once the camera is at street height, further mouse wheel up (zoom in) translates into a focal zoom (no further forward movement).  This means that the camera avoids flying through geometry that is in front of it (which can cause clipping etc.). For prototype simplicity, Phase 3 is **FOV-only** (no cursor anchoring) — once at street level, "zoom into the cursor point" matters less. May revisit if it feels wrong.

**No-hit fallback for cursor anchoring:** If the cursor's ray misses all scene geometry, fall back in order: (a) intersect with the ground plane (y=0); (b) if that's behind the camera or absurdly far, use a fixed point straight ahead at a sensible distance, equivalent to a plain camera-Z dolly.

**Mid-zoom cursor movement:** Each wheel tick re-raycasts, so if the user moves the mouse during a flurry of wheel ticks the anchor updates per tick. Matches Google Maps behavior.

Zooming out

- Each of the above is reversible using mouse-wheel down to zoom out.
- Focal zoom transitions into pedestal up / tilt before we get an excessively wide angle focal zoom, avoiding goldfish-bowl effects of a wide FOV.
- Mouse wheel up/down controls are consistent, so if you zoom in & then out, or zoom out & then in, you end up with the same camera angle.

Eventual camera angle on zoom out

- When zooming in, at the point of entry to Phase 2, the controls store the camera tilt angle, so that the tilting down that occurs on zooming out stops at the original tilt level.
- If the user crosses the Phase 1↔2 boundary multiple times in a session, **the most recent crossing wins** — the stored tilt is overwritten on each downward entry to Phase 2.

**Mac trackpad mapping:** A two-finger pinch on a Mac (or Windows) trackpad arrives in the browser as Ctrl+wheel, and maps naturally onto the "fixed-tilt zoom" Ctrl-modifier behavior described above. Pinch zoom is also cursor-anchored, for consistency. Two-finger scroll up/down (which arrives as a plain wheel event) drives the full 3-phase swoop. No additional mapping needed.



What this gives us:

- birds eye view zoom that matches Google Maps

- street-level focal zoom that matches Google Streetview, and avoids dollying forward through obstacles (already provided by W key if needed)

- a transition between the two, that functionally matches the Google Maps <-> Street view transition, but in a much smoother, continuous manner.

  

What is lost?

- The ability to zoom very closely into the scene at a fixed camera tilt (e.g. top down)

  <img src="image-20260422170034583.png" alt="image-20260422170034583" style="zoom:50%;" />

- Possible option to retain this function: Holding Ctrl or Shift while moving mouse wheel does not trigger the Phase 1 -> Phase 2 transition, and allows the user to do a close zoom at a fixed camera tilt angle.





## Low Tilt-Angle View

Proposal for how these new mechanics are used to enable a low angle view (which Google Maps does not offer) in a usable way, that links seamlessly with the birds-eye view.

- LB+mouse = truck/pedestal (world co-ordinates).  As discussed above, there is a sudden transition to these controls from the top-down controls at 30 degrees.

- Shift+LB+mouse = pan/tilt.  Key difference from top-down view is the center of rotation, which is determined by the "bounds based" logic and will either be the diorama center (when outside a bounded diorama), or the camera itself (when inside a bounded diorama, or within an unbounded cityscape)

- WASD keys continue to map to truck/dolly (world co-ordinates).

- Mouse wheel varies depending on camera elevation, following the 3-phase "swoop" pattern.

  - Above about 10m, this is a dolly along the camera's Z axis.
  - Below 10m, this translates into a pedestal down, with tilt (if necessary) such that at 1.5m camera height, the view is horizontal
  - Once at 1.5m camera height (street view), this becomes a focal zoom.
  - !! Actually not happy with this in all cases - I think it still needs more thought
    - Transition between rapid forward dolly movement to pedestal down, when hitting 10m elevation could feel like a weird and unexpected change of direction
    - If the camera is quite distant from a diorama, and at low (1.5m) elevation, it's not clear that a focal zoom is correct.  Maybe should continue to dolly until we reach the diorama boundary?
    - (not actually sure there's anything really tricky here, just needs a little more thought & care)

  

## "Street View"

Proposal for how these new mechanics are used to enable a "Street View"-like experience., that blends seamlessly with the other views.

- LB+mouse = truck/pedestal (world co-ordinates) - because the camera angle is broadly horizontal.  This gives a nice easy way to fly / levitate from a street view position.
  - (minor open question: what happens when camera looks up to the sky?  Do these controls remain the same?  Or flip back to truck/dolly?)
- Shift+LB+mouse = pan/tilt, with camera as the center of rotation
  - This matches Google Stree View controls.
  - Note that mouse directions (as per Google Street View) are reversed vs. a typical FPS.  The model is still "grab the world and move it", rather than "mouse controls camera angle".  See "FPS Mode" below for a possible way of adding an FPS-like controls option alongside.
- WASD keys continue to map to truck/dolly (world co-ordinates).  These are a great fit for this view.
- Mouse wheel delivers:
  - Focal zoom on mouse wheel up.  This matches google street view.
  - Pedestal up + tilt + eventual zoom out looking down.  This also matches how zoom out in google street view results in a return to the map view.  But it delivers it in a seamless and continuous way, which is much smoother than what google maps offers.
    

## Double Click Navigation

*!! Some initial ideas here.  Some refinement still needed*

Double-click to navigate is a powerful additional navigation tool, which we should keep as a supplement to the controls above.  However the current implementation has a few issues:

### Discoverability

a) Hover indications don't even show what item is clickable

Here, mouse is hovering over a (clickable) car, but the whole lane is highlighted.  Highlighting doesn't take account of raycast order, while clicking does?

![image-20260420142818403](image-20260420142818403.png)



b) Click does apply the highlighting  box correctly, but there's no indication that a double click will do anything.

![image-20260420142932153](image-20260420142932153.png)


Suggested solutions:

(a) fix hover highlighting so it respects raycast order and matches what will result from clicking

(b) some sort of caption text indicating possibilities when hovering over an item (or maybe just once an item is clicked, a caption to indicate the double click possibility)



### Viewpoint selection

Double click always navigates the user to a face-on view of the "front" of the object.  Unfortunately that doesn't make sense for the user, so behaviour feels inconsistent.  For example:

(a) for a person/car that brings us down to street height

(b) for a road lane, that puts us in the far distance

(c) with a 4 storey building, a click puts us floating in space at 2nd/3rd storey level (whether I was coming from a high-pov perspective, or street level)

(d) Some objects have a clear "front" e.g. car, person, some buildings.  Others don't (e.g. tree) making it hard to anticipate movement.

What would I intuitively expect from double-click navigation?

- Give me a good view of the item
- Don't radically change my camera angle: if I click on a car that I see side on or from behind, it's weird to be swung all the way round to the front of it.  Alignment makes sense, but rotation should be limited to < 90 degrees.
- (probably) don't change my elevation.  Not sure about this: when I have a wide view of the scene, it's great to be able to zoom right in to street level with a double click.  But when I'm at street level and I double click a building and shoot 2-3 storeys into the air that feels unexpected.
  - This suggests: double click should bring down to street level, but should not send flying up.  That then raises the question: how do I get back to a wide (drone) view?
    - Suggestion from above is that the principal mechanism for this would be mouse-wheel-down, which delivers pedestal-up movement, and an eventual return to a bird's eye view mode.
  - Seems that wanting a building-level view of a building (level with the building mid-height) and wanting a street-level view of a building are both plausible things a user could desire.  How to offer both in a way that's intuitive?
    - A model where a double-click never increases camera elevation (but can reduce it) might work.
      - If user is high above the scene, and double clicks a building, they see the building from 3rd storey level.
      - If user is at 3rd storey level above street level and double clicks a building, they move in front of the building (at the same level)
      - If user is at street level and double clicks a building, they come to the front door.  From here they can use mouse-wheel-down to pedestal up to a higher point of view if needed.
- Navigation for double-click on a lane feels completely broken at the moment.
  - Zooms right out to a very wide view; but maybe the user just wanted to TP their street level view a few meters along the street?
  - Clicking on a lane should probably resolve to a UV point on that lane and navigate there, rather than treating the whole lane as an "object" that the user wants to see the "front" of.

**Facing direction after navigation.** Rather than relying on each object having a defined "front" (which works for cars/people but not for trees, generic geometry, etc.), the resulting view's heading **snaps to the closest cardinal direction (N/S/E/W)** to the user's current camera heading. This gives a predictable rule that works for any object including lanes, and avoids large unwanted rotations.



## FPS Mode

It might be desirable to offer a more immersive "FPS mode".  Characteristics would be:

- "pointer lock" so that camera view follows the mouse even when LB is not down.  Note mouse controls inverted relative to "Street View" mode.
- WASD navigation

See an A-Frame example here: https://c-frame.github.io/aframe-extras/examples/castle/



This feels substantially more immersive and dynamic than a view where you have to press the mouse button to move the camera view.  It may also be quite a familiar mechanic to some users.

The major disadvantage is that the "pointer lock" means that the mouse can no longer be used to interact with the 2D overlay controls.

An option for enabling this kind of movement could be:

- It automatically activates when a key is held down (Ctrl, maybe), and deactivates when the key is released
- A small visual clue (e.g. camera FOV adjusts by 2%) signals to the user when they enter and exit this mode.
- 2D UI overlay elements disappear, or fade, to show they are not interactable in this mode.

Key is that it can only be entered intentionally, and it's not possible for a user to get stuck in this mode.  Ctrl is a convenient key for this, but there is some contention with Ctrl/Shift being used as a mouse modifier in the Google Maps control scheme.  Potentially we could just use Shift as that modifier, and keep Ctrl for FPS Mode.

Not clear what should happen when FPS mode is activated when the user is not at street-view level.

I don't see "FPS Mode" as a key navigation mechanic - for close-up work that is Street View and/or Double Click navigation.  But it could potentially be a neat alternative navigation that some users might find appealing and/or familiar.


## Other questions

Are touch controls in scope, or are we focussed on desktop only?







