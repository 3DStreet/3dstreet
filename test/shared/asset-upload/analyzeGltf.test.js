import { describe, it, expect } from 'vitest';
import {
  isGltfJsonFile,
  analyzeGltfJson,
  analyzeGltfFile,
  gltfRejectionMessage
} from '../../../src/shared/asset-upload/analyzeGltf.js';

const encode = (obj) => new TextEncoder().encode(JSON.stringify(obj)).buffer;
const asFile = (buffer) => ({ arrayBuffer: async () => buffer });

// Minimal Sketchfab-shaped .gltf: JSON referencing sibling files.
const externalRefGltf = {
  asset: { version: '2.0' },
  buffers: [{ uri: 'scene.bin', byteLength: 1234 }],
  images: [{ uri: 'textures/material_baseColor.png' }]
};

// Fully embedded .gltf: data: URI buffer, bufferView-packed image.
const selfContainedGltf = {
  asset: { version: '2.0' },
  buffers: [
    { uri: 'data:application/octet-stream;base64,AAAA', byteLength: 3 }
  ],
  images: [{ bufferView: 0, mimeType: 'image/png' }]
};

describe('isGltfJsonFile', () => {
  it('matches .gltf only, case-insensitively', () => {
    expect(isGltfJsonFile({ name: 'scene.gltf' })).toBe(true);
    expect(isGltfJsonFile({ name: 'SCENE.GLTF' })).toBe(true);
    expect(isGltfJsonFile({ name: 'model.glb' })).toBe(false);
    expect(isGltfJsonFile({})).toBe(false);
  });
});

describe('analyzeGltfJson', () => {
  it('flags external buffer and image URIs', () => {
    const { selfContained, externalRefs } = analyzeGltfJson(externalRefGltf);
    expect(selfContained).toBe(false);
    expect(externalRefs).toEqual([
      'scene.bin',
      'textures/material_baseColor.png'
    ]);
  });

  it('accepts embedded data: URIs and bufferView images', () => {
    const { selfContained, externalRefs } = analyzeGltfJson(selfContainedGltf);
    expect(selfContained).toBe(true);
    expect(externalRefs).toEqual([]);
  });

  it('treats a uri-less buffer as unresolvable in a standalone .gltf', () => {
    const { selfContained, externalRefs } = analyzeGltfJson({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 10 }]
    });
    expect(selfContained).toBe(false);
    expect(externalRefs).toEqual(['(binary buffer)']);
  });

  it('is self-contained when there are no buffers or images at all', () => {
    expect(analyzeGltfJson({ asset: { version: '2.0' } }).selfContained).toBe(
      true
    );
  });
});

describe('analyzeGltfFile', () => {
  it('classifies external-ref .gltf', async () => {
    const result = await analyzeGltfFile(asFile(encode(externalRefGltf)));
    expect(result.status).toBe('external-refs');
    expect(result.externalRefs).toContain('scene.bin');
  });

  it('classifies self-contained .gltf', async () => {
    const result = await analyzeGltfFile(asFile(encode(selfContainedGltf)));
    expect(result.status).toBe('self-contained');
  });

  it('detects GLB bytes behind a .gltf name', async () => {
    // 'glTF' magic + version 2 + length header.
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, 12, true);
    const result = await analyzeGltfFile(asFile(buffer));
    expect(result.status).toBe('binary');
  });

  it('classifies unparseable input as invalid', async () => {
    const result = await analyzeGltfFile(
      asFile(new TextEncoder().encode('not json at all').buffer)
    );
    expect(result.status).toBe('invalid');
  });

  it('classifies JSON without an asset field as invalid', async () => {
    const result = await analyzeGltfFile(asFile(encode({ foo: 'bar' })));
    expect(result.status).toBe('invalid');
  });
});

describe('gltfRejectionMessage', () => {
  it('names the file and the missing sibling files', () => {
    const msg = gltfRejectionMessage('scene.gltf', {
      status: 'external-refs',
      externalRefs: ['scene.bin', 'textures/a.png']
    });
    expect(msg).toContain('scene.gltf');
    expect(msg).toContain('scene.bin');
    expect(msg).toContain('.glb');
  });

  it('truncates long ref lists', () => {
    const msg = gltfRejectionMessage('scene.gltf', {
      status: 'external-refs',
      externalRefs: ['a.bin', 'b.png', 'c.png', 'd.png', 'e.png']
    });
    expect(msg).toContain('+2 more');
    expect(msg).not.toContain('d.png');
  });

  it('falls back to an invalid-file message', () => {
    const msg = gltfRejectionMessage('scene.gltf', {
      status: 'invalid',
      externalRefs: []
    });
    expect(msg).toContain('not a valid glTF');
  });
});
