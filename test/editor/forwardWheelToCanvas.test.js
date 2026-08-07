import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { forwardWheelToCanvas } from '../../src/editor/lib/forwardWheelToCanvas.js';

// Every on-canvas control the shape editor draws must be `pointer-events: auto`
// to be hovered or pressed, which also makes it swallow the wheel — and the
// camera's zoom handlers are bound on the canvas, which is not one of their
// ancestors. This is the whole of the fix, and all of it is observable in jsdom:
// the target of the re-dispatch, the members carried across, and the swallowing
// of the page scroll.

describe('forwardWheelToCanvas', () => {
  let savedAframe;
  let canvas;
  let chip;

  beforeEach(() => {
    savedAframe = globalThis.AFRAME;
    canvas = document.createElement('canvas');
    globalThis.AFRAME = { scenes: [{ canvas }] };
    chip = document.createElement('div');
    chip.addEventListener('wheel', forwardWheelToCanvas, { passive: false });
  });

  afterEach(() => {
    globalThis.AFRAME = savedAframe;
  });

  it('forwards a wheel over a chip to the canvas and swallows the page scroll', () => {
    const seen = [];
    canvas.addEventListener('wheel', (e) => seen.push(e));
    const ev = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    chip.dispatchEvent(ev);
    expect(seen.length).toBe(1);
    expect(seen[0].deltaY).toBe(120);
    // Without this the browser scrolls the page as well as zooming the camera.
    expect(ev.defaultPrevented).toBe(true);
  });

  // The members the zoom consumers actually read. The clone is built by the
  // WheelEvent constructor from the original's dictionary, so a member left out
  // of the copy reaches the camera as its default (0, or false) — a zoom that
  // runs at the wrong rate or in the wrong direction rather than one that fails.
  it('carries the members the zoom handlers read', () => {
    let got = null;
    canvas.addEventListener('wheel', (e) => {
      got = e;
    });
    chip.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -53,
        deltaMode: 1,
        clientX: 40,
        clientY: 90,
        ctrlKey: true,
        cancelable: true
      })
    );
    expect(got).not.toBe(null);
    expect(got.deltaY).toBe(-53);
    expect(got.deltaMode).toBe(1);
    expect(got.clientX).toBe(40);
    expect(got.clientY).toBe(90);
    expect(got.ctrlKey).toBe(true);
    // The consumers call preventDefault() on what they receive, which warns and
    // does nothing on a non-cancelable event.
    expect(got.cancelable).toBe(true);
  });

  // Re-dispatched AT the canvas, never at `document`: the clone inherits
  // `bubbles: true`, so a listener bound higher would see its own event come
  // back round and forward it again, once per notch per round.
  it('dispatches at the canvas rather than at the document', () => {
    document.body.appendChild(chip);
    const atDocument = [];
    document.addEventListener('wheel', (e) => atDocument.push(e.target));
    // `bubbles: true` as a real wheel event is, since that is what the clone
    // inherits and what makes dispatching at `document` a loop.
    chip.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true })
    );
    // The original bubbles up to document once. The clone's target is the
    // canvas, which is not in the document, so nothing of ours arrives there.
    expect(atDocument).toEqual([chip]);
    document.body.removeChild(chip);
  });

  // Before the scene exists there is nothing to forward to, and the page must
  // keep its own scroll rather than losing it to a handler that does nothing.
  it('leaves the event alone when there is no canvas yet', () => {
    globalThis.AFRAME = { scenes: [] };
    const ev = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    chip.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
