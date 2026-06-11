/* global STREET */
import * as Sentry from '@sentry/react';

// Diagnostics watchdog for the long-standing "phantom translation" bug:
// a click(+~1px drag) intended as a camera move instead grabs the transform
// gizmo and teleports the selected entity (often a whole street) many metres
// — and the jump is NOT undoable.
//
// Root causes identified (2026-06; kept here so the diagnostics make sense):
//
// 1. THE JUMP — two mechanisms in TransformControls.js, both producing a
//    huge first-frame delta:
//    a. STALE DRAG ORIGIN: in `onPointerDown`, when the pointer ray hits a
//       gizmo picker but the follow-up `activePlane` intersect MISSES,
//       `oldPosition`/`offset` are NOT refreshed — they keep values from a
//       PREVIOUS gesture — yet `_dragging` is latched and `scope.axis` set.
//       The next `onPointerMove` that does hit the plane computes
//       `position = oldPosition(stale) + (point − offset(stale))` → teleport.
//    b. GLANCING PLANE: with the camera nearly edge-on to the active drag
//       plane, the ray–plane intersection point races, so 1 px of pointer
//       movement is many metres of world movement.
//
// 2. NOT UNDOABLE — `EntityUpdateCommand` captures `oldValue` via
//    `entity.getAttribute('position')`, and A-Frame returns the LIVE
//    `object3D.position` for position/rotation/scale. TransformControls has
//    already mutated the object BEFORE dispatching `objectChange`, so the
//    command's oldValue is the post-jump position: oldValue === newValue for
//    a single-move gesture, and undo is a perfect no-op. (Every gizmo drag's
//    undo actually restores the position after the FIRST move event; it is
//    just imperceptible unless the first move IS the whole jump.)
//
// RELIABLE REPRO (verified 2026-06-10 via scripted browser events; jump of
// 10.7 m from a 3 px drag, undo no-op confirmed):
//   1. Select a street (translate mode, gizmo at the street origin).
//   2. Put the camera LOW and nearly horizontal with the gizmo on screen
//      (eye-level looking down the street, e.g. camera y=3 looking at the
//      origin from 100 m away).
//   3. Click on/near the gizmo centre and drag 1–3 px vertically. At that
//      angle the invisible picker of the depth axis (the arrow pointing
//      toward/away from you) covers the centre of the screen, and its drag
//      plane is the near-edge-on ground plane → metres of motion per pixel.
//
// The watchdog is READ-ONLY: it never alters the gesture, the entity, or the
// undo stack. It snapshots the true pre-drag pose on the controls'
// `mouseDown` (dispatched before any mutation), flags a translate gesture
// whose world jump is implausible for the pixels travelled, and on mouseUp
// emits one structured report: console.error + `window.__transformWatchdogLog`
// + a STREET.notify toast, including the pre-drag pose and a copy-paste
// restore command, plus the undo-stack probe proving (or clearing) the
// oldValue === newValue no-op.

// Trigger thresholds. A legit ground-plane drag is roughly
// cameraHeight/700 metres per pixel (~0.7 m/px at 500 m up), so 2 m/px AND
// a 5 m total jump together are far outside organic editing yet conservative
// enough not to fire on intentional long drags (high m/px needs a SHORT
// pixel distance once the 5 m floor is met).
const PHANTOM_MIN_JUMP_METRES = 5;
const PHANTOM_MIN_METRES_PER_PIXEL = 2;

const fmtVec = (v) => `${v.x.toFixed(3)} ${v.y.toFixed(3)} ${v.z.toFixed(3)}`;

export function attachTransformWatchdog(transformControls, inspector) {
  const container = inspector.container;

  // TransformControls' mouseDown/objectChange events carry no pointer info,
  // so track the pointer independently (capture phase, passive — runs even
  // though TransformControls stopPropagation()s its own handling).
  let pointerDown = null;
  let pointerNow = null;
  const onPointerDown = (event) => {
    const p = event.changedTouches ? event.changedTouches[0] : event;
    pointerDown = { x: p.clientX, y: p.clientY, t: performance.now() };
    pointerNow = { x: p.clientX, y: p.clientY };
  };
  const onPointerMove = (event) => {
    if (!pointerDown) return;
    const p = event.changedTouches ? event.changedTouches[0] : event;
    pointerNow = { x: p.clientX, y: p.clientY };
  };
  container.addEventListener('pointerdown', onPointerDown, true);
  container.addEventListener('pointermove', onPointerMove, true);

  let gesture = null;

  // Dispatched from TransformControls.onPointerDown BEFORE any mutation —
  // this snapshot is the true pre-drag pose (unlike the undo command's).
  transformControls.addEventListener('mouseDown', () => {
    const object = transformControls.object;
    if (!object) return;
    const camera = inspector.camera;
    gesture = {
      entityId: (object.el && object.el.id) || '(no id)',
      mode: transformControls.getMode(),
      axis: transformControls.axis,
      space: transformControls.space,
      prePosition: object.position.clone(),
      cameraPosition: camera ? camera.position.clone() : null,
      gizmoScale: transformControls.scale ? transformControls.scale.x : null,
      pointerAtDown: pointerDown ? { ...pointerDown } : null,
      undoLengthAtStart:
        inspector.history && inspector.history.undos
          ? inspector.history.undos.length
          : null,
      changeCount: 0,
      flagged: false
    };
  });

  transformControls.addEventListener('objectChange', () => {
    const object = transformControls.object;
    if (!gesture || !object) return;
    gesture.changeCount++;
    if (gesture.mode !== 'translate' || gesture.flagged) return;
    const jump = object.position.distanceTo(gesture.prePosition);
    const px = gesture.pointerAtDown
      ? Math.max(
          1,
          Math.hypot(
            pointerNow.x - gesture.pointerAtDown.x,
            pointerNow.y - gesture.pointerAtDown.y
          )
        )
      : 1;
    if (
      jump >= PHANTOM_MIN_JUMP_METRES &&
      jump / px >= PHANTOM_MIN_METRES_PER_PIXEL
    ) {
      gesture.flagged = true;
      gesture.jumpAtFlag = jump;
      gesture.pxAtFlag = px;
      gesture.changeIndexAtFlag = gesture.changeCount;
      // Early signal in case mouseUp never arrives (tab switch, error).
      console.warn(
        `[transform-watchdog] phantom translation in progress: ${jump.toFixed(
          1
        )} m over ${px.toFixed(0)} px (full report on mouseup)`
      );
    }
  });

  transformControls.addEventListener('mouseUp', () => {
    const g = gesture;
    gesture = null;
    if (!g || !g.flagged) return;
    const object = transformControls.object;
    if (!object) return;

    // Probe the undo stack: the gesture's entityupdate command (updatable,
    // so all of this drag's objectChange events merged into one). If its
    // oldValue equals its newValue, undo is a no-op — the smoking gun for
    // the "not undoable" half of the bug.
    let undoProbe = null;
    const undos = inspector.history && inspector.history.undos;
    if (undos && undos.length) {
      const cmd = undos[undos.length - 1];
      undoProbe = {
        type: cmd.type,
        component: cmd.component,
        entityId: cmd.entityId,
        oldValue: cmd.oldValue,
        newValue: cmd.newValue,
        undoWouldNoOp:
          cmd.type === 'entityupdate' && cmd.oldValue === cmd.newValue,
        undoStackGrewThisGesture:
          g.undoLengthAtStart != null
            ? undos.length > g.undoLengthAtStart
            : null
      };
    }

    const report = {
      what: 'phantom-translation',
      when: new Date().toISOString(),
      entityId: g.entityId,
      mode: g.mode,
      axis: g.axis,
      space: g.space,
      jumpMetres: +object.position.distanceTo(g.prePosition).toFixed(3),
      jumpAtFirstFlagMetres: +g.jumpAtFlag.toFixed(3),
      pointerPixels: +g.pxAtFlag.toFixed(1),
      metresPerPixel: +(g.jumpAtFlag / g.pxAtFlag).toFixed(2),
      objectChangeEvents: g.changeCount,
      flaggedOnChangeEvent: g.changeIndexAtFlag,
      prePosition: fmtVec(g.prePosition),
      postPosition: fmtVec(object.position),
      cameraPosition: g.cameraPosition ? fmtVec(g.cameraPosition) : null,
      gizmoScale: g.gizmoScale,
      undoProbe,
      restoreCommand: `document.getElementById('${g.entityId}').setAttribute('position', '${fmtVec(g.prePosition)}')`
    };

    window.__transformWatchdogLog = window.__transformWatchdogLog || [];
    window.__transformWatchdogLog.push(report);

    console.error(
      '[transform-watchdog] PHANTOM TRANSLATION DETECTED — ' +
        `'${report.entityId}' moved ${report.jumpMetres} m on a ` +
        `${report.pointerPixels} px drag (${report.metresPerPixel} m/px).` +
        (undoProbe && undoProbe.undoWouldNoOp
          ? ' Undo for this move is a NO-OP (command oldValue === newValue).'
          : '') +
        ' Pre-drag pose and restore command below; full history in ' +
        'window.__transformWatchdogLog.',
      report
    );

    if (
      typeof STREET !== 'undefined' &&
      STREET.notify &&
      STREET.notify.errorMessage
    ) {
      STREET.notify.errorMessage(
        `Caught an accidental move: an entity jumped ` +
          `${report.jumpMetres} m from a tiny drag. Press ` +
          `${navigator.platform?.startsWith('Mac') ? 'Cmd' : 'Ctrl'}+Z to undo.`
      );
    }

    // Production telemetry: in prod nobody sees the console, so ship the
    // report to Sentry (no-op when Sentry isn't initialized, e.g. local dev).
    try {
      Sentry.captureMessage('phantom-translation', {
        level: 'warning',
        extra: report
      });
    } catch (e) {
      // Telemetry must never break the editor.
    }
  });
}
