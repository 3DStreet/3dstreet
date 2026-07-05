import { NodeIO } from '@gltf-transform/core';
import { KHRXMP, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { vec3, mat3 } from 'gl-matrix';

// ALL_EXTENSIONS so required extensions in the exporter output (e.g.
// EXT_texture_webp, emitted for textures loaded from webp images) don't
// make readBinary throw "Missing required extension".
// Errors are the caller's to handle and log (AppMenu.jsx).
export async function transformUVs(glbBuffer) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  // Read the buffer directly instead of file
  const document = await io.readBinary(new Uint8Array(glbBuffer));

  // Document-level extension checks
  const root = document.getRoot();
  const matrixMap = new Map();

  // Compute UV transform matrix for each material's base color texture
  for (const material of root.listMaterials()) {
    const info = material.getBaseColorTextureInfo();
    const transform = info?.getExtension('KHR_texture_transform');
    if (!transform) continue;

    const matrix = mat3.create();
    mat3.translate(matrix, matrix, transform.getOffset() || [0, 0]);
    mat3.rotate(matrix, matrix, -(transform.getRotation() || 0));
    mat3.scale(matrix, matrix, transform.getScale() || [1, 1]);
    matrixMap.set(material, matrix);
  }

  // Transform UVs
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (!material) continue;

      const matrix = matrixMap.get(material);
      if (!matrix) continue;

      const uvAttribute = prim.getAttribute('TEXCOORD_0');
      if (!uvAttribute) continue;

      const uv = uvAttribute.clone();
      for (let i = 0, el = [0, 0, 1], il = uv.getCount(); i < il; i++) {
        uv.getElement(i, el);
        vec3.transformMat3(el, el, matrix);
        uv.setElement(i, el);
      }
      prim.setAttribute('TEXCOORD_0', uv);
    }
  }

  // Remove KHR_texture_transform extension
  for (const extension of root.listExtensionsUsed()) {
    if (extension.extensionName === 'KHR_texture_transform') {
      extension.dispose();
    }
  }

  // Write back to binary
  return await io.writeBinary(document);
}

export async function addGLBMetadata(glbBuffer, metadata) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  // Create an Extension attached to the Document.
  const document = await io.readBinary(new Uint8Array(glbBuffer));
  const xmpExtension = document.createExtension(KHRXMP);
  const root = document.getRoot();

  // Create Packet property.
  const packet = xmpExtension
    .createPacket()
    .setContext({
      geo: 'https://3dstreet.com'
    })
    .setProperty('geo:version', '0.1')
    .setProperty('geo:longitude', metadata.longitude ?? 0)
    .setProperty('geo:latitude', metadata.latitude ?? 0)
    .setProperty('geo:orthometricHeight', metadata.orthometricHeight ?? null)
    .setProperty('geo:geoidHeight', metadata.geoidHeight ?? null)
    .setProperty('geo:ellipsoidalHeight', metadata.ellipsoidalHeight ?? null)
    .setProperty('geo:orientation', metadata.orientation ?? null);

  root.setExtension('KHR_xmp_json_ld', packet);

  return await io.writeBinary(document);
}
