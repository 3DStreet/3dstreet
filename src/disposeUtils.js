import { releaseSharedSource } from './sharedTextureSources';

function disposeTextures(material) {
  // Explicitly dispose any textures assigned to this material
  for (const propertyName in material) {
    const texture = material[propertyName];
    if (texture?.isTexture) {
      if (texture.userData?._batchKeepAlive) continue;
      const image = texture.source.data;
      if (image instanceof ImageBitmap && !image._batchKeepAlive) {
        // A canonical Source shared via gltf-model-plus' load-time dedup is refcounted:
        // release it (closes the bitmap only when this is its last live texture). three.js
        // frees the GPU texture via Source refcounting on texture.dispose() either way.
        if (image._sharedSource) {
          releaseSharedSource(image);
        } else {
          image.close && image.close();
        }
      }
      texture.dispose();
    }
  }
}

function disposeMaterial(m) {
  if (m.userData?._batchKeepAlive) return;
  disposeTextures(m);
  m.dispose(); // disposes any programs associated with the material
}

export function disposeNode(node) {
  if (node.isMesh) {
    const geometry = node.geometry;
    if (geometry && !geometry.userData?._batchKeepAlive) {
      geometry.dispose();
    }

    const material = node.material;
    if (material) {
      if (Array.isArray(material)) {
        for (let i = 0, l = material.length; i < l; i++) {
          disposeMaterial(material[i]);
        }
      } else {
        disposeMaterial(material);
      }
    }
  }
}
