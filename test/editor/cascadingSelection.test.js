import { describe, expect, it, beforeEach } from 'vitest';
import {
  getSelectionChain,
  resolveClickSelection
} from '../../src/editor/lib/cascadingSelection.js';

// Minimal stand-ins for A-Frame entities: jsdom elements with the isEntity
// flag the resolver checks. Custom tags keep tagName distinctions honest
// (A-SCENE vs A-ENTITY).
function entity(
  parent,
  { tag = 'a-entity', id, attrs = {}, classes = [] } = {}
) {
  const el = document.createElement(tag);
  el.isEntity = true;
  if (id) el.id = id;
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  for (const cls of classes) {
    el.classList.add(cls);
  }
  if (parent) parent.appendChild(el);
  return el;
}

describe('cascadingSelection', () => {
  let scene;
  let streetContainer;
  let street;
  let segmentA;
  let segmentB;
  let vehicleA1;
  let vehicleA2;
  let vehicleB1;

  beforeEach(() => {
    document.body.innerHTML = '';
    scene = entity(document.body, { tag: 'a-scene' });
    streetContainer = entity(scene, { id: 'street-container' });
    street = entity(streetContainer, { attrs: { 'managed-street': '' } });
    segmentA = entity(street, { attrs: { 'street-segment': '' } });
    segmentB = entity(street, { attrs: { 'street-segment': '' } });
    vehicleA1 = entity(segmentA, { classes: ['autocreated'] });
    vehicleA2 = entity(segmentA, { classes: ['autocreated'] });
    vehicleB1 = entity(segmentB, { classes: ['autocreated'] });
  });

  describe('getSelectionChain', () => {
    it('orders the chain top-down from the street to the intersected entity', () => {
      expect(getSelectionChain(vehicleA1)).toEqual([
        street,
        segmentA,
        vehicleA1
      ]);
    });

    it('stops at container elements (street-container, a-scene)', () => {
      expect(getSelectionChain(street)).toEqual([street]);
      const topLevel = entity(scene, {});
      expect(getSelectionChain(topLevel)).toEqual([topLevel]);
    });

    it('skips inspector-owned and hidden wrapper ancestors', () => {
      const wrapper = entity(street, {
        attrs: { 'data-aframe-inspector': '' }
      });
      const hidden = entity(wrapper, { classes: ['hideFromSceneGraph'] });
      const child = entity(hidden, {});
      expect(getSelectionChain(child)).toEqual([street, child]);
    });

    it('stops when the parent is not an entity', () => {
      const orphanParent = document.createElement('div');
      document.body.appendChild(orphanParent);
      const child = entity(orphanParent, {});
      expect(getSelectionChain(child)).toEqual([child]);
    });
  });

  describe('resolveClickSelection', () => {
    it('returns null for a click on empty space', () => {
      expect(resolveClickSelection(null, null)).toBeNull();
      expect(resolveClickSelection(null, segmentA)).toBeNull();
    });

    it('selects the street first when nothing is selected', () => {
      expect(resolveClickSelection(vehicleA1, null)).toBe(street);
      expect(resolveClickSelection(segmentA, null)).toBe(street);
    });

    it('drills one level deeper per click: street, segment, vehicle', () => {
      expect(resolveClickSelection(vehicleA1, street)).toBe(segmentA);
      expect(resolveClickSelection(vehicleA1, segmentA)).toBe(vehicleA1);
    });

    it('keeps the deepest entity selected on repeated clicks', () => {
      expect(resolveClickSelection(vehicleA1, vehicleA1)).toBe(vehicleA1);
    });

    it('selects a top-level entity directly (chain of one)', () => {
      const box = entity(scene, {});
      expect(resolveClickSelection(box, null)).toBe(box);
      expect(resolveClickSelection(box, vehicleA1)).toBe(box);
    });

    it('selects a sibling at the same depth directly (entered scope)', () => {
      expect(resolveClickSelection(vehicleA2, vehicleA1)).toBe(vehicleA2);
    });

    it('selects the sibling segment when clicking across segments', () => {
      expect(resolveClickSelection(vehicleB1, vehicleA1)).toBe(segmentB);
      expect(resolveClickSelection(segmentB, segmentA)).toBe(segmentB);
    });

    it('pops back up when clicking an ancestor of the selection', () => {
      expect(resolveClickSelection(segmentA, vehicleA1)).toBe(segmentA);
    });

    it('starts over at the street when the selection is in an unrelated tree', () => {
      const otherStreet = entity(streetContainer, {
        attrs: { 'managed-street': '' }
      });
      const otherSegment = entity(otherStreet, {
        attrs: { 'street-segment': '' }
      });
      expect(resolveClickSelection(vehicleA1, otherSegment)).toBe(street);
      const topLevel = entity(scene, {});
      expect(resolveClickSelection(vehicleA1, topLevel)).toBe(street);
    });

    it('survives a selection that was removed from the DOM', () => {
      segmentB.remove();
      expect(resolveClickSelection(vehicleA1, segmentB)).toBe(street);
    });
  });
});
