import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';
import {
  KINDS,
  kindsOfEntity,
  markersOfKinds
} from '../../src/tested/transform-kinds.js';

// The transform-limit markers each constrained component sets on its entity
// when it starts, against the limits its kind declares for the command guard
// and the load-time levelling. The two are separate code, so a change to one
// alone must fail here.
//
// shape.js statically imports the app store; the same two-method stub the other
// shape component tests use.
vi.mock('../../src/store.js', () => ({
  default: {
    getState: () => ({ unitsPreference: 'metric' }),
    subscribe: () => () => {}
  }
}));

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  window.STREET.utils = window.STREET.utils || {};
  await import('../../src/aframe-components/street-segment.js');
  await import('../../src/aframe-components/street-generated-clones.js');
  await import('../../src/aframe-components/street-generated-stencil.js');
  await import('../../src/aframe-components/street-generated-striping.js');
  await import('../../src/aframe-components/street-generated-pedestrians.js');
  await import('../../src/aframe-components/street-generated-rail.js');
  await import('../../src/aframe-components/managed-street.js');
  await import('../../src/aframe-components/street-align.js');
  await import('../../src/aframe-components/shape.js');
  await import('../../src/aframe-components/shape-vertex.js');
  await import('../../src/aframe-components/managed-intersection.js');
  window.AFRAME.emitReady();
});

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

const STREET_JSON = JSON.stringify({
  name: 'Marker test',
  width: 3,
  length: 20,
  segments: [
    {
      name: 'Drive',
      type: 'drive-lane',
      width: 3,
      elevation: 0,
      direction: 'inbound',
      color: '#ffffff',
      surface: 'asphalt'
    }
  ]
});

const transformMarkers = (el) =>
  el
    .getAttributeNames()
    .filter((name) => name.startsWith('data-transform-'))
    .sort();

async function mount(component, value) {
  const el = await elFactory();
  mounted.push(el.sceneEl);
  el.setAttribute(component, value);
  await vi.waitFor(() => expect(el.components[component]).toBeDefined());
  return el;
}

// What each kind's component is mounted with, and the markers its init must
// set, as literals.
const MOUNTED = {
  shape: {
    value: 'closed: true',
    markers: [
      'data-transform-no-reparent',
      'data-transform-no-scale',
      'data-transform-yaw-only'
    ]
  },
  'managed-street': {
    value: { sourceType: 'json-blob', sourceValue: STREET_JSON },
    markers: ['data-transform-no-scale']
  },
  'managed-intersection': {
    value: '',
    markers: ['data-transform-no-scale']
  }
};

const componentKinds = KINDS.filter((kind) => kind.component).map(
  (kind) => kind.component
);

describe("a component's markers match its kind's declared limits", () => {
  it('covers every kind made by a component (fails if a kind is added without a mounted case here)', () => {
    expect(Object.keys(MOUNTED).sort()).toEqual([...componentKinds].sort());
  });

  it.each(componentKinds)(
    '%s sets exactly the markers its kind declares (fails if a marker line is removed from its init, or one side gains a marker the other lacks)',
    async (component) => {
      const { value, markers } = MOUNTED[component];
      const el = await mount(component, value);
      expect(transformMarkers(el)).toEqual(markers);
      expect(transformMarkers(el)).toEqual(
        markersOfKinds(kindsOfEntity(el)).slice().sort()
      );
    }
  );
});
