import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@shared/assets', () => ({
  getServedUrl: (item) => item?.optimizedSourceUrl ?? item?.storageUrl
}));

const { getEntityAssetType, replaceCloudAssetInScene, swapCloudAssetInScene } =
  await import('@/editor/lib/asset-upload/swapCloudAsset.js');

function makeEntity(attrs, tag = 'a-entity') {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe('replaceCloudAssetInScene (#2142)', () => {
  let scene;
  let execute;

  beforeEach(() => {
    scene = document.createElement('a-scene');
    document.body.replaceChildren(scene);
    execute = vi.fn();
    globalThis.AFRAME = { scenes: [scene], INSPECTOR: { execute } };
  });

  const source = { assetId: 'old', ownerUid: 'someone' };

  it('infers the asset type from the entity components', () => {
    expect(getEntityAssetType(makeEntity({ splat: 'src: x' }))).toBe('splat');
    expect(getEntityAssetType(makeEntity({ 'gltf-model': 'url(x)' }))).toBe(
      'mesh'
    );
    expect(getEntityAssetType(makeEntity({ material: 'src: x' }))).toBe(
      'image'
    );
    expect(getEntityAssetType(makeEntity({}, 'a-image'))).toBe('image');
    expect(getEntityAssetType(makeEntity({}))).toBe(null);
  });

  it('repoints every splat using the source asset in one multi command', () => {
    const a = makeEntity({
      splat: 'src: old.rad',
      'data-asset-id': 'old',
      'data-asset-owner-uid': 'someone'
    });
    const b = makeEntity({
      splat: 'src: old.rad',
      'data-asset-id': 'old',
      'data-asset-owner-uid': 'someone'
    });
    const other = makeEntity({
      splat: 'src: x',
      'data-asset-id': 'other',
      'data-asset-owner-uid': 'someone'
    });
    scene.append(a, b, other);

    const count = replaceCloudAssetInScene(source, {
      id: 'new',
      userId: 'me',
      type: 'splat',
      storageUrl: 'new.spz',
      optimizedSourceUrl: 'new.rad'
    });

    expect(count).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
    const [cmd, updates] = execute.mock.calls[0];
    expect(cmd).toBe('multi');
    const forA = updates.filter(([, p]) => p.entity === a).map(([, p]) => p);
    // Identity is updated before the source URL.
    expect(forA.map((p) => p.component)).toEqual([
      'data-asset-id',
      'data-asset-owner-uid',
      'splat'
    ]);
    expect(forA[0].value).toBe('new');
    expect(forA[1].value).toBe('me');
    expect(forA[2]).toMatchObject({ property: 'src', value: 'new.rad' });
    expect(updates.some(([, p]) => p.entity === other)).toBe(false);
  });

  it('swaps only an image texture, leaving the plane size alone', () => {
    const img = makeEntity({
      material: 'src: old.png',
      'data-asset-id': 'old',
      'data-asset-owner-uid': 'someone'
    });
    scene.append(img);

    replaceCloudAssetInScene(source, {
      id: 'new',
      userId: 'me',
      type: 'image',
      storageUrl: 'new.png',
      metadata: { width: 800, height: 400 }
    });

    const payloads = execute.mock.calls[0][1].map(([, p]) => p);
    expect(payloads.find((p) => p.component === 'material')).toMatchObject({
      property: 'src',
      value: 'new.png'
    });
    expect(payloads.some((p) => p.component === 'geometry')).toBe(false);
  });

  it('never puts a different asset type on an entity', () => {
    scene.append(
      makeEntity({
        'gltf-model': 'url(old.glb)',
        'data-asset-id': 'old',
        'data-asset-owner-uid': 'someone'
      })
    );
    const count = replaceCloudAssetInScene(source, {
      id: 'new',
      userId: 'me',
      type: 'image',
      storageUrl: 'new.png'
    });
    expect(count).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps the copy-to-library swap working for GLBs', () => {
    const mesh = makeEntity({
      'gltf-model': 'url(old.glb)',
      'data-asset-id': 'old',
      'data-asset-owner-uid': 'someone'
    });
    scene.append(mesh);
    const count = swapCloudAssetInScene(source, {
      assetId: 'copy',
      userId: 'me',
      storageUrl: 'copy.glb'
    });
    expect(count).toBe(1);
    const [, updates, label] = execute.mock.calls[0];
    expect(label).toBe('Copy asset to my library');
    expect(updates.map(([, p]) => p.component)).toEqual([
      'data-asset-id',
      'data-asset-owner-uid',
      'gltf-model'
    ]);
    expect(updates[2][1].value).toBe('url(copy.glb)');
  });
});
