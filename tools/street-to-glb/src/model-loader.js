// model-loader.js — fetch a catalog GLB, decode Draco, parse it into a THREE
// scene, and hand back a clone ready to place. Draco decompression is done with
// @gltf-transform + draco3dgltf (no Web Workers, which three's DRACOLoader
// needs), re-serialized as an uncompressed GLB that three's GLTFLoader parses
// directly. Fetched bytes are cached on disk; parsed scenes are cached in
// memory, so N clones of one model download + parse once.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { THREE, GLTFLoader } from './three-node.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');

let ioPromise = null;
function getIO() {
  if (!ioPromise) {
    ioPromise = (async () =>
      new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
          'draco3d.decoder': await draco3d.createDecoderModule()
        }))();
  }
  return ioPromise;
}

async function fetchGlbBytes(url) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const key = createHash('sha1').update(url).digest('hex');
  const file = join(CACHE_DIR, key + '.glb');
  if (existsSync(file)) return new Uint8Array(readFileSync(file));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeFileSync(file, bytes);
  return bytes;
}

// Decode any Draco compression and return an uncompressed GLB Uint8Array. A
// plain (non-Draco) GLB round-trips unchanged.
async function decompressGlb(bytes) {
  const io = await getIO();
  const doc = await io.readBinary(bytes);
  for (const ext of doc.getRoot().listExtensionsUsed()) {
    if (ext.extensionName === 'KHR_draco_mesh_compression') ext.dispose();
  }
  return io.writeBinary(doc);
}

const loader = new GLTFLoader();
function parseGlb(bytes) {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  return new Promise((resolve, reject) => {
    loader.parse(ab, '', resolve, reject);
  });
}

// url -> Promise<THREE.Group> (the raw gltf.scene, kept as a template).
const sceneCache = new Map();
function loadTemplate(url) {
  if (!sceneCache.has(url)) {
    sceneCache.set(
      url,
      (async () => {
        const raw = await fetchGlbBytes(url);
        const plain = await decompressGlb(raw);
        const gltf = await parseGlb(plain);
        return gltf.scene;
      })()
    );
  }
  return sceneCache.get(url);
}

// Find a named node in a template (gltf-part). Falls back to a case-insensitive
// and prefix match so minor naming drift still resolves.
function findPart(root, partName) {
  let found = root.getObjectByName(partName);
  if (found) return found;
  const lower = partName.toLowerCase();
  root.traverse((node) => {
    if (found) return;
    const n = (node.name || '').toLowerCase();
    if (n === lower || n.startsWith(lower)) found = node;
  });
  return found;
}

// Load a resolved model descriptor and return a fresh holder Group whose child
// is the model (keeping the model's own internal transforms). The caller sets
// position/rotation/scale on the holder — mirroring the app's entity(placement)
// + object3D(model) split so a part's local offset survives placement.
export async function loadModel(descriptor) {
  const template = await loadTemplate(descriptor.url);
  const holder = new THREE.Group();

  if (descriptor.part) {
    // gltf-part: isolate the first plain Mesh under the named node, exactly
    // like gltf-part.js selectFromModel — dropping the shared skeleton/atlas
    // context so we don't drag in every sibling character.
    const partNode = findPart(template, descriptor.part);
    if (!partNode) throw new Error(`part "${descriptor.part}" not in ${descriptor.url}`);
    const mesh = partNode.getObjectByProperty('type', 'Mesh');
    if (!mesh) throw new Error(`no Mesh under part "${descriptor.part}"`);
    const clone = mesh.clone(true);
    clone.geometry = clone.geometry.clone();
    holder.add(clone);
  } else {
    // Full model: SkeletonUtils.clone (not Object3D.clone) so skinned rigs keep
    // valid bone bindings — a plain clone leaves the skeleton pointing at the
    // template's bones and the export writes dangling joint indices.
    holder.add(cloneSkeleton(template));
  }
  return holder;
}

export { THREE };
