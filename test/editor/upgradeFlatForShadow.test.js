import { describe, expect, it } from 'vitest';
import { upgradeFlatForShadow } from '../../src/editor/lib/commands/ComponentAddCommand.js';

// A stand-in entity: getAttribute returns parsed component data, and
// setAttribute(name, prop, value) records single-property writes.
function fakeEntity({ shader, receive }) {
  const attrs = {
    material: shader ? { shader } : undefined,
    shadow: receive === undefined ? undefined : { cast: true, receive }
  };
  const writes = [];
  return {
    writes,
    getAttribute: (name) => attrs[name],
    setAttribute: (name, prop, value) => writes.push([name, prop, value])
  };
}

describe('upgradeFlatForShadow (#2123)', () => {
  it('switches a flat material when a receiving shadow is added', () => {
    const el = fakeEntity({ shader: 'flat', receive: true });
    expect(upgradeFlatForShadow(el, 'shadow')).toBe(true);
    expect(el.writes).toEqual([['material', 'shader', 'flat-shadow']]);
  });

  it('leaves a shadow that does not receive alone', () => {
    const el = fakeEntity({ shader: 'flat', receive: false });
    expect(upgradeFlatForShadow(el, 'shadow')).toBe(false);
    expect(el.writes).toEqual([]);
  });

  it('leaves any other shader alone', () => {
    for (const shader of ['standard', 'flat-shadow']) {
      const el = fakeEntity({ shader, receive: true });
      expect(upgradeFlatForShadow(el, 'shadow')).toBe(false);
      expect(el.writes).toEqual([]);
    }
  });

  it('ignores entities without a material and other components', () => {
    expect(upgradeFlatForShadow(fakeEntity({ receive: true }), 'shadow')).toBe(
      false
    );
    const el = fakeEntity({ shader: 'flat', receive: true });
    expect(upgradeFlatForShadow(el, 'animation')).toBe(false);
    expect(el.writes).toEqual([]);
  });
});
