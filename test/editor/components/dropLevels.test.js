import { describe, expect, it } from 'vitest';
import {
  levelAtX,
  pickLevel
} from '@/editor/components/scenegraph/dropLevels.js';

// A row's depth-1 content starts 6 px right of its left edge and each level
// is indented 30 px further.
const ROW_LEFT = 120;
const indentOf = (level) => ROW_LEFT + 6 + 30 * (level - 1);

describe('the level under the pointer in the layer panel', () => {
  it("changes exactly at each level's indent, so a level owns the 30 px band that starts at its own content (fails if the band is centred on the indent)", () => {
    for (const level of [1, 2, 3, 4]) {
      expect(levelAtX(indentOf(level) - 1, ROW_LEFT)).toBe(level - 1);
      expect(levelAtX(indentOf(level), ROW_LEFT)).toBe(level);
      expect(levelAtX(indentOf(level) + 1, ROW_LEFT)).toBe(level);
      expect(levelAtX(indentOf(level) + 29, ROW_LEFT)).toBe(level);
    }
  });

  it('takes the allowed level nearest the pointer, the shallower on a tie, the deepest right of every indent and the shallowest left of them (fails on a tie going deeper)', () => {
    const levels = (...ls) => ls.map((level) => ({ level }));
    expect(pickLevel(levels(1, 3), 2).level).toBe(1);
    expect(pickLevel(levels(3, 1), 2).level).toBe(1);
    expect(pickLevel(levels(1, 2, 3), 7).level).toBe(3);
    expect(pickLevel(levels(2, 3), 0).level).toBe(2);
    expect(pickLevel(levels(1, 2, 3), 2).level).toBe(2);
    expect(pickLevel([], 2)).toBe(null);
  });
});
