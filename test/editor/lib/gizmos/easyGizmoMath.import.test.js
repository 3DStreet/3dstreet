import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('imports arithmetic before A-Frame installs THREE', async () => {
  vi.resetModules();
  vi.stubGlobal('THREE', undefined);
  const math = await import('@/editor/lib/gizmos/easyGizmoMath.js');
  expect(math.lerp(2, 4, 0.5)).toBe(3);
  expect(math.chevronLayout(2, 0.5).count).toBe(4);
  expect(Number.isFinite(math.continuityAllowance(0.1))).toBe(true);
});
