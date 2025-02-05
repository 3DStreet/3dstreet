import { NodeIO } from '@gltf-transform/core';
import { KHRTextureTransform } from '@gltf-transform/extensions';
import { vec3, mat3 } from 'gl-matrix';

async function transformUVs(glbBuffer) {
  try {
    // Initialize IO with extension
    const io = new NodeIO().registerExtensions([KHRTextureTransform]);

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
    const processedBuffer = await io.writeBinary(document);
    return processedBuffer;
  } catch (error) {
    console.error('Error processing GLTF file:', error);
    throw error;
  }
}

export { transformUVs };
