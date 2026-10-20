import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commandsByType } from '@/editor/lib/commands/index.js';
import { resolveCommand } from '@/editor/lib/resolveCommand.js';
import {
  entityIn,
  mountPlacementScene
} from './lib/groups/_placementHarness.js';

let root;

beforeEach(() => {
  root = mountPlacementScene().root;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('resolveCommand', () => {
  it('builds the command for what will actually run, after every rewrite (fails if the command is looked up before the rewrites)', () => {
    const tilted = entityIn(root, {
      id: 'tilted',
      rotation: '10 30 5',
      scale: '2 2 2'
    });
    const grouping = resolveCommand('entityupdate', {
      entity: tilted,
      component: 'class',
      value: 'user-group'
    });
    expect(grouping.Cmd).toBe(commandsByType.get('multi'));
    expect(grouping.cmdName).toBe('multi');
    expect(grouping.payload).toHaveLength(3);
    expect(grouping.refusal).toBe(null);

    const payload = { entity: tilted, component: 'scale', value: '3 3 3' };
    const plain = resolveCommand('entityupdate', payload);
    expect(plain.Cmd).toBe(commandsByType.get('entityupdate'));
    expect(plain.cmdName).toBe('entityupdate');
    expect(plain.payload).toBe(payload);
    expect(plain.levelled).toBe(null);

    const g = entityIn(root, { id: 'g', cls: 'user-group' });
    const refused = resolveCommand('entityupdate', {
      entity: g,
      component: 'scale',
      value: '2 2 2'
    });
    expect(refused.refusal).toBe('Scaling is not available for this element.');
    expect(refused.Cmd).toBe(commandsByType.get('entityupdate'));
  });
});
