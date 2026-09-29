/* global describe, it */

/**
 * Progressive GLB pipeline rules (#1990): which asset docs the manual
 * "Make streamable" request accepts, and the one-live-job-per-asset dedupe.
 */

const assert = require('assert');
const {
  PROGRESSIVE_JOB_KIND,
  progressiveRefusalReason,
  findActiveProgressiveJob
} = require('../../public/functions/progressive-rules.js');

const mesh = (extra = {}) => ({
  type: 'mesh',
  storagePath: 'users/u1/assets/meshes/a.glb',
  ...extra
});

describe('progressiveRefusalReason', () => {
  it('accepts a public or unlisted mesh with a source', () => {
    assert.strictEqual(progressiveRefusalReason(mesh()), null);
    assert.strictEqual(
      progressiveRefusalReason(mesh({ visibility: 'public' })),
      null
    );
    assert.strictEqual(
      progressiveRefusalReason(mesh({ visibility: 'unlisted' })),
      null
    );
  });

  it('refuses a missing doc', () => {
    assert.strictEqual(progressiveRefusalReason(null), 'not_found');
    assert.strictEqual(progressiveRefusalReason(undefined), 'not_found');
  });

  it('refuses non-mesh assets (splats have their own RAD pipeline)', () => {
    assert.strictEqual(
      progressiveRefusalReason(mesh({ type: 'splat' })),
      'not_mesh'
    );
    assert.strictEqual(
      progressiveRefusalReason(mesh({ type: 'image' })),
      'not_mesh'
    );
  });

  it('refuses soft-deleted assets and assets with no source path', () => {
    assert.strictEqual(
      progressiveRefusalReason(mesh({ deleted: true })),
      'deleted'
    );
    assert.strictEqual(
      progressiveRefusalReason(mesh({ storagePath: '' })),
      'no_source'
    );
    assert.strictEqual(progressiveRefusalReason({ type: 'mesh' }), 'no_source');
  });

  it('refuses private assets: the processed copy lives on a public CDN', () => {
    assert.strictEqual(
      progressiveRefusalReason(mesh({ visibility: 'private' })),
      'private'
    );
  });

  it('checks in a fixed order so the most fundamental reason wins', () => {
    assert.strictEqual(
      progressiveRefusalReason({ type: 'splat', deleted: true }),
      'not_mesh'
    );
    assert.strictEqual(
      progressiveRefusalReason(mesh({ deleted: true, visibility: 'private' })),
      'deleted'
    );
  });
});

describe('findActiveProgressiveJob', () => {
  it('returns the non-terminal progressive job, ignoring other kinds', () => {
    const jobs = [
      { id: 'rad', kind: 'splat-rad', status: 'queued' },
      { id: 'old', kind: PROGRESSIVE_JOB_KIND, status: 'succeeded' },
      { id: 'live', kind: PROGRESSIVE_JOB_KIND, status: 'running' }
    ];
    assert.strictEqual(findActiveProgressiveJob(jobs)?.id, 'live');
  });

  it('returns null when every progressive job is terminal', () => {
    const jobs = [
      { id: 'a', kind: PROGRESSIVE_JOB_KIND, status: 'failed' },
      { id: 'b', kind: PROGRESSIVE_JOB_KIND, status: 'skipped' }
    ];
    assert.strictEqual(findActiveProgressiveJob(jobs), null);
    assert.strictEqual(findActiveProgressiveJob([]), null);
    assert.strictEqual(findActiveProgressiveJob(undefined), null);
  });
});
