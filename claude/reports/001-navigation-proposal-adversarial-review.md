# 001 — Adversarial Review: 3D Street Navigation Proposal

*Review of `/claude/reference/3D Street Navigation Proposal.md` (draft 2026-04-22).*
*Written 2026-05-07.*

There's a lot of strong thinking in the proposal — the swoop zoom, the bounds-based rotation center, and the hard-cut at 30° are all credible answers to real problems. Below is the adversarial pass: things to push back on, gaps, and edge cases that would bite during implementation. Organized roughly by severity.

## 1. Scope decisions that should be made *before* prototyping

These aren't critiques of the design — they're decisions whose absence will cause rework.

- **Touch controls (line 266).** Punted to "Other questions," but it's load-bearing. Almost every gesture defined (LB+drag, Shift+LB, RB context menu, Ctrl-hold FPS) has no clean touch equivalent. If touch is in scope, the design changes fundamentally — one-finger pan, two-finger rotate/tilt, pinch zoom. If touch is out of scope, commit to that and accept that mobile users get a degraded experience (3DStreet runs in mobile browsers today). Decide up front.
- **WebXR / VR mode.** The codebase has first-class WebXR. The proposal doesn't say whether these controls are desktop-only with VR as an entirely separate path, or whether some unification is intended. Probably the former, but say so.
//!! For touch / WebXR these are out-of-scope while we are prototyping.  If we like the prototype, we can revisit again how we tie this in with touch & WebXR navigation systems.  My understanding is that current users are heavily skewed towards keyboard & mouse
- **Editor mode interactions.** This is the biggest unstated collision. The Inspector has selection, transform gizmos, drag-to-move-handles, etc. — all of which use LB and LB+modifier. The proposal treats the canvas as a navigation surface, but in editor mode it's also an interaction surface. How does navigation arbitrate with selection and gizmos? Always-nav-unless-over-gizmo? A modal "view vs edit" toggle? This needs to be addressed before any prototype lands, otherwise the prototype will work great in viewer mode and break the editor.
//!! The existing nav system uses "nav-unless-over-gizmo" and that's not a big problem as gizmos are small and conspicuous, so accidental triggering is rare.  I don't think the proposed changes make this any worse.
- **Existing-user migration.** RB→Shift+LB for pan/tilt is a significant break for current muscle memory. There should be a story for this (opt-in flag during a beta? legacy mode? on-screen hints first time?).
//!! To worry about after prototyping (if we like the prototype)

## 2. Conceptual ambiguities

- **Tilt convention.** "Tilt pointing downwards from 90° up to 30°" is ambiguous — is 90° straight down or horizontal? The doc uses both readings. Pin this convention down (suggest 0° = straight down, 90° = horizontal, since "tilt up from down" reads more naturally when the user is in birds-eye and tilts toward forward).
//!! 90 degrees should be straaight down, zero degrees horizontal.  30 degrees threshold is a gentle downward gaze.
- **"Bounded" vs "unbounded" scenes.** The bounds-based rotation logic hinges on this distinction but never defines it. Streetmix imports have natural bounds (the street); a geo-located scene with Google Tiles is effectively infinite. What's the test? AABB of `managed-street`? Anything containing `street-geo`? User-tagged? Asset-derived? This deserves a paragraph — it shows up again and again.
//!! I don't know the codebase well enough to say what the best way to distinguish is.  Please make some suggestions.
- **WASD coordinate system.** The doc says "world coordinates" for consistency, but classic FPS WASD is camera-yaw-relative (W goes "where I'm looking"). World-axis WASD means W can take you sideways relative to your facing direction in a rotated scene. The intended meaning is probably *horizontal-plane-projected camera-relative* (W = forward in world XZ, toward where the camera yaw faces, ignoring tilt). Worth disambiguating; otherwise the prototype will implement the wrong thing.
//!! Yes this looks to be wrong in all cases.  Did indeed mean movement in the horizontal plane, but with "forward" matching the direction of the camera (and the camera's y axis when the camera is pointing directly down)
- **"Linear" wheel zoom (line 40).** Truly linear zoom is bad UX — sluggish at altitude, runaway at low altitude. Google Maps *looks* linear but is exponential (each tick = fixed % of altitude). Probably want exponential too; "linear" is likely the wrong word for the intended feel.
//!! Correct

## 3. Design tensions worth stress-testing

### 3a. Hard-cut at 30° between truck/dolly and truck/pedestal

The proposal explicitly rejects blending here, and there's a coherent argument for that. But the consequences:

- A user at 35° tilt drags downward → world moves horizontally. They tilt to 25° and the same gesture now pedestals. The mode is invisible unless the "visual indicator" is well-designed (and the proposal doesn't say what it is).
- **Mid-gesture mode flips.** What if a Shift+LB tilt-drag crosses 30° during the drag? Does the *next* LB drag use the new mode? That's fine. But if a single LB drag begins at 31°, drags down a little (no tilt change yet), then the user nudges Shift+LB to 25° — the world ends up partly horizontal-moved and partly vertical-moved within what felt like one continuous task. Mode should probably be **latched at gesture start** and held for the whole drag.
- The "visual indicator" needs spec'ing. A subtle cursor change is easy to miss.
//!! Agree there is a risk here - to evaluate when we have a prototype.

### 3b. Bounds-based rotation center

This is the cleverest part of the design and also the one with the most failure modes.

- **Long, narrow scenes.** A single Streetmix segment has bounds maybe 50m × 6m. If the camera is 2m off the side of the street, it's "outside the diorama" — but the diorama center could be 25m away along the street. Rotating about it produces enormous translation for small angle changes. Diorama-mode probably needs a *minimum* rotation distance, or to fall back to camera-center when bounds are highly anisotropic.
//!! Yes, absolutely a problem.  Suggest the "bounds" should be a cylinder, centered on the diorama center, matching it's greatest dimension.
- **Spatial blending of rotation centers.** When the rotation center is itself a function of camera position, and rotation moves the camera, you get a moving target — the camera can spiral or hunt. Worth prototyping early to see if it's actually smooth or if it produces a visible "drift." Consider latching the rotation center at gesture start, like the mode-switch above.
//!! evaluate in prototype
- **Boundary crossings mid-gesture.** What if the user is rotating and the camera passes through the bounds boundary? Rotation center jumps from camera→diorama or vice versa. Latching at gesture start fixes this too.
//!! Cylindrical bounds centered on the diorama center should address this.  Although latching the rotation center at gesture start might also be sensible.
- **Inside XZ bounds but high above.** Camera at (0, 50, 0) above a small diorama whose XZ bounds contain (0, 0). Rule 3 says "rotate about camera position" → but visually the diorama is below and you'd expect to orbit it. Probably need an elevation component to the test, not just XZ.
//!! Don't understand the concern.  If the camera is looking down, tilt is > 30 degrees and we rotate about the center of the current camera view.  If the camera is looking horizontally, the scene will be out of view??  Also if the camera is directly above the diorama center than it doesn't matter whether we rotate about the camera position or the diorama center as they are in the same place?

### 3c. 3-phase swoop zoom

The most ambitious part. Several real problems:

- **Loss of altitude/tilt independence.** Coupling tilt to altitude means the user can't be at 5m looking down at 60°. The Ctrl-modifier escape hatch helps but produces a state asymmetry: zoom-in with Ctrl, zoom-out without → end up in a different camera state than started. This violates the "wheel up/down is consistent" property the proposal explicitly wants (line 110).
//!! I don't think it violates symmetry as you zoomed in in one mode (with Ctrl) and zoomed out in another mode.
//!! Agree there is risk here, but the spec already acknowledges the issue and proposes a solution - I think we need to test that and see how it feels.
- **"Stored tilt at Phase 2 entry" has multiple-entry ambiguity.** What's stored when the user crosses the Phase 1↔2 boundary repeatedly during exploration? Last crossing wins? First? Reset by some action?
//!! Most recent entry
- **Cursor anchoring.** Google Maps zooms *toward the cursor* — the world point under the cursor stays under the cursor. The spec says "dolly along camera Z" which doesn't anchor. This is a meaningful divergence from the cited inspiration. Worth deciding deliberately, not by omission.
//!! DOn't understand.  If camera dollies alogn Z axis, the center of the camera view will stay at the center of that view.  This is not a dolly along the *world* z axis.
- **Phase 2 is a small window** (10m → 1.5m). With Apple trackpad inertial scroll or a high-DPI mouse, a single flick can blast through it, making the transition look like a teleport rather than a swoop. Probably needs rate-limiting or a minimum animation duration on Phase 2.
//!! disagree it will look like a teleport as the movement is continuous.  Can see how this feels in testing and adjust thresholds/sensitivity if need be.  If a user spins their mouse wheel super hard pointing at the ground, I don't think they should be surprised if they end up on the ground!
- **Forward-direction discontinuity (the proposal flagged this).** Phase 1 dollies forward + down; Phase 2 stops forward motion. Coming in toward a building at the far edge, the camera stops short of it horizontally and ends up at street level *not next to* the building. Users will read this as broken. Possible fix: in Phase 2, continue horizontal motion at a rate that aims the eventual landing point at the original Phase-1 trajectory's projection.
//!! disagree.  If I pick a point and zoom into it, I don't know that I necessarily want to land on that point.  I might want to land "looking at" that point from a reasonable distance.  Prefer to see how this feels, then adjust if it feels wrong.
- **Mac trackpad pinch sends Ctrl+wheel.** The proposed "Ctrl+wheel = fixed-tilt zoom" collides with the OS-level pinch gesture. Real conflict.
//!! Mac (and Windows) trackpad pinch appears identical to Ctrl+wheel, and will result in a zoom in, without transition to the phase2 / phase 3 swoop.  I don't see that as a problem.  On a Mac trackpad, a 2 finger scroll up/down can be used to access the swoop-zoom.

### 3d. Double-click navigation

- **"Never raise elevation" produces asymmetry.** Same double-click on the same building yields different end-states depending on starting altitude. Internally consistent but will read as "the navigation is unpredictable" to users who don't know the rule.
//!! Maybe - will assess when we have a prototype.
- **No animation/interruption story.** What happens if the user mouse-wheels during a double-click animation? Does the swoop zoom intercept and override? Or queue? In practice the answer matters because users will do this.
//!! Not a new issue.  Current implementation appears to drop events received during animation.  I think it's OK to retain that behaviour.
- **"Click on lane → UV point" — at what facing direction?** The proposal says the resulting view should be the lane-as-target. But facing which way? Lane direction? Current camera direction? User intuition is probably "drop me here looking the way I was already looking," but worth being explicit.
//!! Yes, existing camera direction.  Or maybe closest NSEW cardinal direction.
- **"Front" of objects.** Per-object, derived from geometry, or user-overridable? For trees and other no-natural-front objects, what's the rule?
//!! Yes exactly.  Issue with current implementation.  Proposal is to move to closest cardinal direction (NSEW), which removes the need for objects to have a clear "front"
- **Hover highlighting fix (a)** is correct and easy. Worth doing standalone, even before the bigger nav rework.
//!! No - primary goal is learning and prototyping the new nav system, not pushing minor fixes to prod.

### 3e. FPS mode

- **Pointer lock requires a click gesture in all browsers.** You can't enter pointer lock just by holding Ctrl over the canvas — the browser ignores it without a user-initiated event. This means "Ctrl held = FPS" probably has to be "Ctrl + click to engage, release Ctrl to exit," not pure key-hold.
//!! Not sure this is correct.  My understanding:
//!!requestPointerLock() must be called within a transient user activation — a short window of time following any qualifying //!!user interaction, not just a click. That includes:
//!!mousedown / mouseup / click
//!!keydown / keyup
//!!touchstart / touchend
//!!pointerdown / pointerup
//!!So a keypress to enter fullscreen/game mode triggering pointer lock is perfectly valid.

- **Mac Ctrl+click = right-click emulation.** Real conflict.
//!! they are distinguishable in the browser — even though macOS treats Ctrl+click as a right-click equivalent at the OS level, the browser preserves enough information to tell them apart.
//!! There could potentially be an issue for Mac users with a 1-button mouse who depend on Ctrl+LB for RB function.  But single button mice were discountinued in 2009 so I think we are safe there.

- **Mid-drag modifier press.** User holds LB to truck/pedestal, then presses Ctrl. Do controls switch mid-drag? Latch the mode for the gesture's duration.
//!! Not sure which will 

- **Editor 2D overlays disappearing** is a nice idea, but if a user accidentally enters FPS while mid-edit, modal flicker is disruptive. Maybe FPS is gated to viewer mode only.
//!! Not sure this is an issue...  Editor 2D overlay should be removable in one clean operation without flicker?

## 4. Smaller things worth catching now

- **"Plan view button"**: animated transition or instant cut? With other transitions being smooth, an instant cut here would feel inconsistent.
//!! Animated transition
- **Scene-scale generalization.** "10m proximity threshold," "1.5m eye level," "Phase 2 window" are all absolute meters. Streetmix scenes are ~50–100m wide; geo scenes are kilometers. For a scene with an aerial view of a 2km area, these thresholds may not generalize. Either define them relative to scene bounds, or accept they're tuned for human-scale streets only.
//!! These values for prototyping; explore this later on.
- **Performance of bounds queries.** Computing scene bounds per-frame for the rotation-center logic could be expensive on dynamic scenes. Cache and invalidate on scene mutations.
//!! Cache computed scene bounds.
- **Accessibility.** Heavy reliance on Shift/Ctrl modifiers and wheel-only swoop is hostile to reduced-dexterity users and to users without scroll wheels (some trackpads, presentation remotes, etc.). At minimum, every wheel-only behavior should have a keyboard equivalent.
//!! For discussion with Kieran what goals/targets are here.  Keyboard shortcuts can be added as needed.  Not clear that the exsting implementation has set a high bar here.
- **W-key currently exists** as forward-dolly in some form. Confirm that the proposed WASD spec is fully consistent with current behavior, or call out the change explicitly so prototypes don't half-migrate.
//!! Yes, there are some duplicates on WASD that will need to be re-assigned and we'll need to manage education of existing users.  The latter is an issue for a later phase.

## 5. Suggested slicing

If carving slices for prototyping, ordered by risk and dependency:
//!! Disagree - goal of prototyping is to learn about the movement mechanics, especially the ones that are riskiest and most novel.  Not a goal to ship small fixes to production any time soon.

1. **Hover/click discoverability fix** (§3d, item a) — small, high value, low risk, independent of everything else.
2. **30° hard-cut + visual indicator** — smallest unit that lets you validate whether the cut feels jarring or fine.
3. **Bounds-based rotation center for low tilt** — test with a couple of representative scenes (Streetmix, geo, large diorama) before committing to the blending behavior.
4. **3-phase swoop** — biggest risk surface; prototype last, after the bounds and tilt-cut behavior are stable, since it composes on top of them.
//!! You missed FPS view, which propably should be the last phase.

Before any of that, lock down: tilt convention, "bounded scene" definition, WASD coordinate system, touch scope, editor-mode interaction model, and migration plan for RB→Shift+LB. Those decisions cut across all four slices and changing them mid-prototype will be expensive.
