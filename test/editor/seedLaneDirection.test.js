import { describe, expect, it } from 'vitest';
import { seedLaneDirection } from '../../src/editor/lib/segmentPanel.js';

// #1959: a stencil/clones component added by hand to a lane must start out
// following the lane's travel direction, like the import and type-change
// creation paths, or it renders outbound-facing on an inbound lane and is
// permanently skipped by segment direction propagation (which deliberately
// ignores direction: none).
describe('seedLaneDirection', () => {
  it('seeds the lane direction into an empty stencil value', () => {
    expect(seedLaneDirection('street-generated-stencil', '', 'inbound')).toBe(
      'direction: inbound'
    );
    expect(seedLaneDirection('street-generated-stencil', '', 'outbound')).toBe(
      'direction: outbound'
    );
  });

  it('seeds clones too, matching the other creation paths', () => {
    expect(seedLaneDirection('street-generated-clones', '', 'inbound')).toBe(
      'direction: inbound'
    );
  });

  it('resolves multi-instance suffixes to the base component', () => {
    expect(
      seedLaneDirection('street-generated-stencil__2', '', 'inbound')
    ).toBe('direction: inbound');
  });

  it('appends to an existing seed value, normalizing trailing semicolons', () => {
    expect(
      seedLaneDirection(
        'street-generated-clones',
        'mode: random; modelsArray: sedan-rig;',
        'outbound'
      )
    ).toBe('mode: random; modelsArray: sedan-rig; direction: outbound');
  });

  it('leaves a seed value that already sets a direction alone', () => {
    expect(
      seedLaneDirection(
        'street-generated-stencil',
        'direction: none; facing: 90',
        'inbound'
      )
    ).toBe('direction: none; facing: 90');
    expect(
      seedLaneDirection(
        'street-generated-stencil',
        'modelsArray: left; direction: outbound',
        'inbound'
      )
    ).toBe('modelsArray: left; direction: outbound');
  });

  it('does not mistake another property containing "direction" for one', () => {
    // no such property today, but the guard must match whole names only
    expect(
      seedLaneDirection(
        'street-generated-stencil',
        'flowdirection: up',
        'inbound'
      )
    ).toBe('flowdirection: up; direction: inbound');
  });

  it('does nothing for directionless lanes (sidewalk) or non-segment hosts', () => {
    expect(seedLaneDirection('street-generated-stencil', '', 'none')).toBe('');
    expect(seedLaneDirection('street-generated-stencil', '', undefined)).toBe(
      ''
    );
  });

  it('does nothing for generators without their own direction property', () => {
    expect(seedLaneDirection('street-generated-striping', '', 'inbound')).toBe(
      ''
    );
    expect(seedLaneDirection('street-generated-rail', '', 'inbound')).toBe('');
    expect(
      seedLaneDirection('street-generated-pedestrians', '', 'inbound')
    ).toBe('');
    expect(seedLaneDirection('street-generated-grass', '', 'inbound')).toBe('');
  });
});
