import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// entity.js contains JSX inside a .js file, which this test setup cannot
// transform (same workaround as shapeVertexEditing.test.js).
vi.mock('../../src/editor/lib/entity.js', () => ({
  createUniqueId: () => 'x',
  updateEntity: () => {}
}));

import { EntityUpdateCommand } from '../../src/editor/lib/commands/EntityUpdateCommand.js';

// LLM-path schema validation (transformLLMArgs → validateLLMTarget): a
// hallucinated component/property must throw a tool error instead of being
// silently ignored by A-Frame while the tool reports "executed" — the exact
// failure was `managed-street.curve: undefined → 30` followed by a ✅ verdict.
describe('EntityUpdateCommand.transformLLMArgs schema validation', () => {
  let el;

  beforeEach(() => {
    globalThis.AFRAME = {
      components: {
        'managed-street': {
          schema: { length: {}, width: {}, sourceType: {} }
        },
        visible: { isSingleProperty: true, schema: {} },
        position: { isSingleProperty: true, schema: {} }
      }
    };
    el = document.createElement('div');
    el.id = 'street-1';
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
    delete globalThis.AFRAME;
  });

  const args = (overrides) => ({
    entityId: 'street-1',
    value: '30',
    ...overrides
  });

  // The registry pre-resolves entityId (through the editable-subtree guard)
  // and hands the live element to the transform.
  const transform = (a) =>
    EntityUpdateCommand.transformLLMArgs(a, { entity: el });

  it('rejects a hallucinated property on a known component', () => {
    expect(() =>
      transform(args({ component: 'managed-street', property: 'curve' }))
    ).toThrow(/no property 'curve'.*length, width, sourceType/);
  });

  it('rejects a hallucinated component', () => {
    expect(() => transform(args({ component: 'curve' }))).toThrow(
      /Unknown component 'curve'/
    );
  });

  it('accepts a valid property on a known component', () => {
    expect(() =>
      transform(args({ component: 'managed-street', property: 'length' }))
    ).not.toThrow();
  });

  it('prefers the entity instance schema (dynamic schemas) over the registry', () => {
    el.components = {
      'managed-street': { schema: { length: {}, dynamicProp: {} } }
    };
    expect(() =>
      transform(args({ component: 'managed-street', property: 'dynamicProp' }))
    ).not.toThrow();
  });

  it('allows x/y/z on position and rejects other properties', () => {
    expect(() =>
      transform(args({ component: 'position', property: 'y' }))
    ).not.toThrow();
    expect(() =>
      transform(args({ component: 'position', property: 'w' }))
    ).toThrow(/only has properties x, y, z/);
  });

  it('rejects a property arg on a single-property component', () => {
    expect(() =>
      transform(args({ component: 'visible', property: 'value' }))
    ).toThrow(/single-property/);
  });

  it('allows plain attributes and attributes the entity already carries', () => {
    for (const component of ['mixin', 'id', 'class', 'data-some-flag']) {
      expect(() => transform(args({ component }))).not.toThrow();
    }
    el.setAttribute('src', '#old');
    expect(() => transform(args({ component: 'src' }))).not.toThrow();
  });

  it('allows multi-instance component names via the base definition', () => {
    globalThis.AFRAME.components.animation = {
      schema: { property: {}, to: {}, loop: {} }
    };
    expect(() =>
      transform(args({ component: 'animation__spin' }))
    ).not.toThrow();
    expect(() =>
      transform(args({ component: 'animation__spin', property: 'to' }))
    ).not.toThrow();
    expect(() =>
      transform(args({ component: 'animation__spin', property: 'nope' }))
    ).toThrow(/no property 'nope'/);
  });

  it('allows primitive attribute mappings not yet set on the entity', () => {
    el.mappings = { color: 'material.color' };
    expect(() => transform(args({ component: 'color' }))).not.toThrow();
  });

  it('rejects a missing component arg with a readable error', () => {
    expect(() => transform(args({}))).toThrow(/'component' is required/);
  });

  it('skips validation when no entity is supplied (registry throws first)', () => {
    expect(() =>
      EntityUpdateCommand.transformLLMArgs(
        args({ entityId: 'nope', component: 'curve' }),
        { entity: null }
      )
    ).not.toThrow();
  });
});
