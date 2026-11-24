/**
 * sceneSaveMode (#1267, src/editor/lib/sceneAccess.js): how the signed-in
 * user can save the open scene — personal scenes by authorship, team scenes
 * by team role and the edit lock.
 */
import { beforeEach, describe, it, expect } from 'vitest';
import useStore from '@/store';
import { canSaveInPlace, sceneSaveMode } from '@/editor/lib/sceneAccess';

const user = (orgs = []) => ({ uid: 'me', orgs });
const team = (role, memberEditScope) => [
  { orgId: 'org1', role, status: 'active', memberEditScope }
];

function openScene({
  sceneId = 'scene-1',
  authorId = 'me',
  orgId = null,
  lock = 'none'
} = {}) {
  globalThis.STREET = {
    ...(globalThis.STREET || {}),
    utils: { getCurrentSceneId: () => sceneId, getAuthorId: () => authorId }
  };
  useStore.setState({ sceneOrgId: orgId, editLock: { status: lock } });
}

describe('sceneSaveMode', () => {
  beforeEach(() => openScene());

  it('is new before the first save', () => {
    openScene({ sceneId: '' });
    expect(sceneSaveMode(user())).toBe('new');
  });

  it('saves your own personal scene in place, someone else’s as a copy', () => {
    expect(sceneSaveMode(user())).toBe('own');
    openScene({ authorId: 'other' });
    expect(sceneSaveMode(user())).toBe('copy');
  });

  it('saves a team scene in place only while holding the lock', () => {
    openScene({ authorId: 'other', orgId: 'org1', lock: 'mine' });
    expect(sceneSaveMode(user(team('member')))).toBe('team');
    expect(canSaveInPlace(user(team('member')))).toBe(true);
    for (const lock of ['other', 'acquiring', 'none']) {
      openScene({ authorId: 'other', orgId: 'org1', lock });
      expect(sceneSaveMode(user(team('admin')))).toBe('team-locked');
    }
  });

  it('never saves a team scene for its viewers', () => {
    openScene({ orgId: 'org1', lock: 'mine' });
    expect(sceneSaveMode(user(team('viewer')))).toBe('team-viewer');
    expect(canSaveInPlace(user(team('viewer')))).toBe(false);
  });

  it('treats a team scene of a team you are not in as someone else’s, even as its author', () => {
    openScene({ authorId: 'me', orgId: 'org1', lock: 'mine' });
    expect(sceneSaveMode(user())).toBe('copy');
  });

  it('copies another member’s scene when the team lets members edit only their own', () => {
    openScene({ authorId: 'other', orgId: 'org1', lock: 'none' });
    expect(sceneSaveMode(user(team('member', 'own')))).toBe('copy');
    expect(canSaveInPlace(user(team('member', 'own')))).toBe(false);
    // Owners and admins still edit it; a member edits their own.
    expect(sceneSaveMode(user(team('admin', 'own')))).toBe('team-locked');
    openScene({ authorId: 'me', orgId: 'org1', lock: 'mine' });
    expect(sceneSaveMode(user(team('member', 'own')))).toBe('team');
  });
});
