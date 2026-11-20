import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDoc, setDoc } from 'firebase/firestore';

// test/setup.js mocks this module globally; exercise the real one here.
vi.unmock('@shared/utils/tokens');

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'tokenProfile/user-1' })),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS')
}));

const { getTokenProfile } = await import('@shared/utils/tokens');

const snapshot = (data) => ({ exists: () => !!data, data: () => data });

describe('getTokenProfile', () => {
  beforeEach(() => {
    vi.mocked(getDoc).mockReset();
    vi.mocked(setDoc).mockReset();
  });

  it('returns the existing profile without writing', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot({ genToken: 7, geoToken: 1 }));
    await expect(getTokenProfile('user-1')).resolves.toEqual({
      genToken: 7,
      geoToken: 1
    });
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('creates the default profile when none exists', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(null));
    vi.mocked(setDoc).mockResolvedValue();
    const profile = await getTokenProfile('user-1');
    expect(setDoc).toHaveBeenCalledOnce();
    expect(profile).toMatchObject({
      userId: 'user-1',
      genToken: 5,
      geoToken: 3
    });
  });

  it('returns the profile another caller created first when its own create is refused', async () => {
    const created = { userId: 'user-1', genToken: 5, geoToken: 3 };
    vi.mocked(getDoc)
      .mockResolvedValueOnce(snapshot(null))
      .mockResolvedValueOnce(snapshot(created));
    vi.mocked(setDoc).mockRejectedValue(new Error('PERMISSION_DENIED'));
    await expect(getTokenProfile('user-1')).resolves.toEqual(created);
  });

  it('still throws when the create is refused and no profile exists', async () => {
    vi.mocked(getDoc).mockResolvedValue(snapshot(null));
    vi.mocked(setDoc).mockRejectedValue(new Error('PERMISSION_DENIED'));
    await expect(getTokenProfile('user-1')).rejects.toThrow(
      'PERMISSION_DENIED'
    );
  });
});
