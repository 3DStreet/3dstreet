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

async function addGLBMetadata(glbBuffer, metadata) {
  try {
    const io = new NodeIO();
    const document = await io.readBinary(new Uint8Array(glbBuffer));
    const root = document.getRoot();
    const asset = root.getAsset();

    // Preserve existing generator and add our info
    const originalGenerator = asset.generator;
    asset.generator = `${originalGenerator} + 3DStreet Metadata`;

    // Add metadata to copyright
    const geoMetadata = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      geospatial: {
        position: {
          longitude: metadata.longitude ?? 0,
          latitude: metadata.latitude ?? 0,
          orthometricHeight: metadata.orthometricHeight ?? null,
          geoidHeight: metadata.geoidHeight ?? null,
          ellipsoidalHeight: metadata.ellipsoidalHeight ?? null,
          orientation: metadata.orientation ?? null
        }
      },
      custom: metadata.custom || {}
    };

    asset.copyright = JSON.stringify(geoMetadata);
    return await io.writeBinary(document);
  } catch (error) {
    console.error('Error adding metadata:', error);
    throw error;
  }
}

/*
async function addGLBMetadata2(glbBuffer, metadata) {
  try {
    const io = new NodeIO();
    const document = await io.readBinary(new Uint8Array(glbBuffer));
    const root = document.getRoot();

    // Create a dedicated metadata structure
    const geoMetadata = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      geospatial: {
        position: {
          longitude: metadata.longitude ?? 0,
          latitude: metadata.latitude ?? 0,
          orthometricHeight: metadata.orthometricHeight ?? null,
          geoidHeight: metadata.geoidHeight ?? null,
          ellipsoidalHeight: metadata.ellipsoidalHeight ?? null,
          orientation: metadata.orientation ?? null
        }
      },
      custom: metadata.custom || {}
    };

    // Set metadata at multiple levels for redundancy
    root.setExtras({ ...root.getExtras(), extras: geoMetadata });

    // Add to scenes
    root.listScenes().forEach(scene => {
      scene.setExtras({ ...scene.getExtras(), extras: geoMetadata });
    });

    // Add to nodes
    root.listNodes().forEach(node => {
      if (node.getName()?.includes('root') || !node.getParent()) {
        node.setExtras({ ...node.getExtras(), extras: geoMetadata });
      }
    });

    console.log('Metadata added to:', {
      root: root.getExtras(),
      scenes: root.listScenes().map(s => s.getExtras()),
      nodes: root.listNodes().filter(n => n.getExtras()?.metadata).length
    });

    const processedBuffer = await io.writeBinary(document);
    return processedBuffer;
  } catch (error) {
    console.error('Error adding metadata:', error);
    throw error;
  }
}
 */

export { addGLBMetadata };
