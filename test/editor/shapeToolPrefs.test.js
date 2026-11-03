import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useStore from '@/store';

const KEY = '3dstreet-shape-tool-settings';
const DEFAULTS = {
  showMeasurements: true,
  showAngles: false,
  snapStep: 0,
  alignToAxes: true,
  openPanelOnSelect: true
};

// The module caches what it loaded, so every test starts from a fresh copy.
async function freshPrefs() {
  vi.resetModules();
  return import('../../src/editor/lib/shapeToolPrefs.js');
}

beforeEach(() => {
  localStorage.clear();
  useStore.setState({ shapeToolSettings: { ...DEFAULTS } });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('shape tool preferences', () => {
  it('defaults to today’s behaviour on an empty store (fails if a default flips)', async () => {
    const { loadShapeToolSettings } = await freshPrefs();
    expect(loadShapeToolSettings()).toEqual(DEFAULTS);
  });

  it('offers exactly the steps that divide 180, largest first (fails if one is added or dropped)', async () => {
    const { SNAP_STEPS } = await freshPrefs();
    expect(SNAP_STEPS).toEqual([
      90, 60, 45, 36, 30, 20, 18, 15, 12, 10, 9, 6, 5, 4, 3, 2, 1
    ]);
  });

  it('survives a reload', async () => {
    const first = await freshPrefs();
    const changed = {
      showMeasurements: false,
      showAngles: true,
      snapStep: 30,
      alignToAxes: false,
      openPanelOnSelect: false
    };
    first.persistShapeToolSettings(changed);
    const second = await freshPrefs();
    expect(second.loadShapeToolSettings()).toEqual(changed);
  });

  it('keeps only well-formed values, key by key, and never throws on malformed storage (fails if 72 or "45" is accepted)', async () => {
    const { normaliseShapeToolSettings } = await freshPrefs();
    expect(normaliseShapeToolSettings({ snapStep: 72 }).snapStep).toBe(0);
    expect(normaliseShapeToolSettings({ snapStep: 7 }).snapStep).toBe(0);
    expect(normaliseShapeToolSettings({ snapStep: '45' }).snapStep).toBe(0);
    expect(normaliseShapeToolSettings({ snapStep: null }).snapStep).toBe(0);
    expect(normaliseShapeToolSettings({ snapStep: 45 }).snapStep).toBe(45);
    expect(
      normaliseShapeToolSettings({ showAngles: 'yes', alignToAxes: false })
    ).toEqual({ ...DEFAULTS, alignToAxes: false });
    for (const stored of ['{', 'null', '[]', '"x"']) {
      localStorage.setItem(KEY, stored);
      const { loadShapeToolSettings } = await freshPrefs();
      expect(loadShapeToolSettings()).toEqual(DEFAULTS);
    }
  });

  it('falls back to defaults when storage throws, and the store still holds a change for the session', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { loadShapeToolSettings } = await freshPrefs();
    expect(loadShapeToolSettings()).toEqual(DEFAULTS);
    expect(() =>
      useStore.getState().setShapeToolSetting('snapStep', 45)
    ).not.toThrow();
    expect(useStore.getState().shapeToolSettings.snapStep).toBe(45);
  });

  it('is set through the store, which normalises and persists (fails if the store skips either)', () => {
    useStore.setState({ shapeToolSettings: { ...DEFAULTS } });
    useStore.getState().setShapeToolSetting('snapStep', 72);
    expect(useStore.getState().shapeToolSettings.snapStep).toBe(0);
    useStore.getState().setShapeToolSetting('snapStep', 45);
    expect(useStore.getState().shapeToolSettings.snapStep).toBe(45);
    expect(JSON.parse(localStorage.getItem(KEY)).snapStep).toBe(45);
  });

  it('starts the store from the stored settings (fails if the store starts from the defaults)', async () => {
    const stored = { ...DEFAULTS, showAngles: true, snapStep: 30 };
    localStorage.setItem(KEY, JSON.stringify(stored));
    vi.resetModules();
    const { default: freshStore } = await import('@/store');
    expect(freshStore.getState().shapeToolSettings).toEqual(stored);
  });
});
