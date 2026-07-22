// texture-loader.js — load a CDN image URL into a THREE.Texture in Node.
// Surface slabs, stencil atlas and striping textures live as loose images on
// the assets CDN (not embedded in a GLB), so we fetch the bytes ourselves,
// decode them with the napi Image, and wrap the result as a texture the
// GLTFExporter can re-embed. Bytes are disk-cached; textures are memoised.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Image as NapiImage } from '@napi-rs/canvas';
import { THREE } from './three-node.js';

const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');

async function fetchBytes(url) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const ext = url.split('.').pop().split('?')[0].slice(0, 5);
  const file = join(CACHE_DIR, createHash('sha1').update(url).digest('hex') + '.' + ext);
  if (existsSync(file)) return readFileSync(file);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

const cache = new Map(); // url -> Promise<THREE.Texture>

export function loadTexture(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      (async () => {
        const bytes = await fetchBytes(url);
        const img = new NapiImage();
        img.src = bytes; // napi decodes synchronously (jpg/png/webp)
        const texture = new THREE.Texture(img);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false; // glTF texture convention
        texture.needsUpdate = true;
        return texture;
      })()
    );
  }
  return cache.get(url);
}
