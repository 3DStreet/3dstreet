// The one global debug switch (#2043): `?debug=true` or the persisted
// localStorage key turn verbose logging on; nothing else does.
import { describe, it, expect, afterEach, vi } from 'vitest';

async function loadWith({ search = '', stored = null } = {}) {
  vi.resetModules();
  window.history.replaceState(null, '', `/${search}`);
  window.localStorage.removeItem('3dstreet.debug');
  if (stored !== null) window.localStorage.setItem('3dstreet.debug', stored);
  return import('../../../src/shared/utils/debug.js');
}

afterEach(() => {
  window.localStorage.removeItem('3dstreet.debug');
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

describe('global debug switch', () => {
  it('is off by default and debugLog stays silent', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { isDebugEnabled, debugLog } = await loadWith();
    expect(isDebugEnabled()).toBe(false);
    debugLog('[x] hidden');
    expect(log).not.toHaveBeenCalled();
  });

  it('?debug=true turns it on and debugLog prints', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { isDebugEnabled, debugLog } = await loadWith({
      search: '?debug=true'
    });
    expect(isDebugEnabled()).toBe(true);
    debugLog('[x] shown', 1);
    expect(log).toHaveBeenCalledWith('[x] shown', 1);
  });

  it('the localStorage key persists it across loads', async () => {
    const { isDebugEnabled } = await loadWith({ stored: 'true' });
    expect(isDebugEnabled()).toBe(true);
  });

  it('?debug=false overrides a persisted key', async () => {
    const { isDebugEnabled } = await loadWith({
      search: '?debug=false',
      stored: 'true'
    });
    expect(isDebugEnabled()).toBe(false);
  });
});
