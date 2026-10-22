import { describe, expect, it } from 'vitest';
import {
  hasTransformMarker,
  refuseGuardedTransform
} from '@/editor/lib/transformGuard.js';

// The guard on fixture elements: the transform markers as attributes, and the
// kinds that imply them by their component or class.

const NO_SCALE = 'data-transform-no-scale';
const YAW_ONLY = 'data-transform-yaw-only';
const NO_REPARENT = 'data-transform-no-reparent';
const MARKERS = [NO_SCALE, YAW_ONLY, NO_REPARENT];

function element({ attributes = [], classes = [] } = {}) {
  const el = document.createElement('div');
  for (const name of attributes) el.setAttribute(name, '');
  el.classList.add(...classes);
  return el;
}

describe('a write to a transform marker attribute', () => {
  it.each(MARKERS)(
    'is let through when it removes %s, which then limits a kind no less (fails if removing a marker is refused)',
    (marker) => {
      const el = element({ attributes: ['shape', marker] });
      expect(
        refuseGuardedTransform('entityupdate', {
          entity: el,
          component: marker,
          value: null
        })
      ).toBeNull();
      el.removeAttribute(marker);
      expect(hasTransformMarker(el, marker)).toBe(true);
    }
  );

  it.each([
    [
      'an empty value on an element carrying the marker',
      () => element({ attributes: [NO_SCALE] }),
      NO_SCALE,
      ''
    ],
    [
      'a removal on an element not carrying the marker',
      () => element(),
      NO_SCALE,
      null
    ],
    [
      'removing another data attribute',
      () => element({ attributes: [NO_SCALE, 'data-layer-name'] }),
      'data-layer-name',
      null
    ],
    ['adding a marker to a plain element', () => element(), NO_SCALE, '']
  ])(
    'lets through %s (fails if every data attribute write, or every write to a marker name, is refused)',
    (_, make, component, value) => {
      expect(
        refuseGuardedTransform('entityupdate', {
          entity: make(),
          component,
          value
        })
      ).toBeNull();
    }
  );
});

describe('hasTransformMarker on the constrained kinds', () => {
  it.each([
    [
      'a shape',
      { attributes: ['shape'] },
      { [NO_SCALE]: true, [YAW_ONLY]: true, [NO_REPARENT]: true }
    ],
    [
      'a managed street',
      { attributes: ['managed-street'] },
      { [NO_SCALE]: true, [YAW_ONLY]: false, [NO_REPARENT]: false }
    ],
    [
      'a managed intersection',
      { attributes: ['managed-intersection'] },
      { [NO_SCALE]: true, [YAW_ONLY]: false, [NO_REPARENT]: false }
    ],
    [
      'a group',
      { classes: ['user-group'] },
      { [NO_SCALE]: true, [YAW_ONLY]: true, [NO_REPARENT]: false }
    ],
    [
      'an element with only the no-scale attribute',
      { attributes: [NO_SCALE] },
      { [NO_SCALE]: true, [YAW_ONLY]: false, [NO_REPARENT]: false }
    ]
  ])(
    'reports the markers %s carries by its kind, without their attributes (fails if the guard does not read kinds, or a kind declares the wrong markers)',
    (_, setup, expected) => {
      const el = element(setup);
      for (const marker of MARKERS) {
        expect(hasTransformMarker(el, marker), marker).toBe(expected[marker]);
      }
    }
  );

  it('refuses scaling a managed street and tilting a shape whose marker attributes are gone (fails if the guard reads only attributes)', () => {
    expect(
      refuseGuardedTransform('entityupdate', {
        entity: element({ attributes: ['managed-street'] }),
        component: 'scale',
        value: '2 2 2'
      })
    ).toBe('Scaling is not available for this element.');
    expect(
      refuseGuardedTransform('entityupdate', {
        entity: element({ attributes: ['shape'] }),
        component: 'rotation',
        value: '10 30 0'
      })
    ).toBe('This element can only be rotated about the vertical axis.');
    expect(
      refuseGuardedTransform('entityupdate', {
        entity: element(),
        component: 'scale',
        value: '2 2 2'
      })
    ).toBeNull();
  });
});
