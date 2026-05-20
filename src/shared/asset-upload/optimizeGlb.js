/**
 * Client-side GLB optimization via gltf-transform.
 *
 * Default pipeline:
 *   dedup → instance → weld → resample → prune → sparse
 *     → textureCompress (webp, quality 0.85, max 2048×2048)
 *     → draco (edgebreaker)
 *
 * Early-exit conditions:
 *   - Both KHR_draco_mesh_compression and EXT_texture_webp already present →
 *     treated as already optimized, pipeline skipped entirely.
 *   - Optimized output ≥ original size → original bytes returned.
 *
 * Returns { blob, metadata } where metadata includes optimizationSkipped,
 * inputBytes, and outputBytes.
 *
 * `draco3dgltf` is a Node-only module (it imports `fs`); a webpack
 * fallback / polyfill needs to be in place for this file to bundle.
 *
 * Heavy deps (gltf-transform, draco3dgltf, meshoptimizer) are loaded lazily
 * so the editor's first paint is unaffected.
 */

let depsPromise = null;

async function loadDeps() {
  if (!depsPromise) {
    depsPromise = (async () => {
      const [core, extensions, functions, draco3d] = await Promise.all([
        import('@gltf-transform/core'),
        import('@gltf-transform/extensions'),
        import('@gltf-transform/functions'),
        import('draco3dgltf')
      ]);
      const draco3dDefault = draco3d.default || draco3d;
      const [decoderModule, encoderModule] = await Promise.all([
        draco3dDefault.createDecoderModule(),
        draco3dDefault.createEncoderModule()
      ]);
      return {
        WebIO: core.WebIO,
        ALL_EXTENSIONS: extensions.ALL_EXTENSIONS,
        functions,
        decoderModule,
        encoderModule
      };
    })();
  }
  return depsPromise;
}

/**
 * Optimize a GLB file in-browser.
 *
 * @param {File|Blob} file - Source GLB.
 * @returns {Promise<{ blob: Blob, metadata: object }>}
 *   blob: optimized (or original) GLB bytes
 *   metadata: { optimizationSkipped, reason?, inputBytes, outputBytes }
 */
export async function optimizeGlb(file) {
  const { WebIO, ALL_EXTENSIONS, functions, decoderModule, encoderModule } =
    await loadDeps();

  const {
    dedup,
    instance,
    weld,
    resample,
    prune,
    sparse,
    textureCompress,
    draco
  } = functions;

  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': decoderModule,
      'draco3d.encoder': encoderModule
    });

  const arrayBuffer = await file.arrayBuffer();
  const originalBytes = new Uint8Array(arrayBuffer);
  const inputBytes = originalBytes.byteLength;

  const document = await io.readBinary(originalBytes);

  // Skip if already compressed with both Draco and WebP
  const extensionsUsed = document
    .getRoot()
    .listExtensionsUsed()
    .map((e) => e.extensionName);
  const hasDraco = extensionsUsed.includes('KHR_draco_mesh_compression');
  const hasWebP = extensionsUsed.includes('EXT_texture_webp');
  if (hasDraco && hasWebP) {
    return {
      blob: new Blob([originalBytes], { type: 'model/gltf-binary' }),
      metadata: {
        optimizationSkipped: true,
        reason: 'already_optimized',
        inputBytes,
        outputBytes: inputBytes
      }
    };
  }

  await document.transform(
    dedup(),
    instance(),
    weld(),
    resample(),
    prune(),
    sparse(),
    textureCompress({
      targetFormat: 'webp',
      quality: 0.85,
      resize: [2048, 2048]
    }),
    draco({ method: 'edgebreaker' })
  );

  const output = await io.writeBinary(document);
  const outputBytes = output.byteLength;

  // Fall back to original if optimization made it larger
  if (outputBytes >= inputBytes) {
    return {
      blob: new Blob([originalBytes], { type: 'model/gltf-binary' }),
      metadata: {
        optimizationSkipped: true,
        reason: 'not_smaller',
        inputBytes,
        outputBytes
      }
    };
  }

  return {
    blob: new Blob([output], { type: 'model/gltf-binary' }),
    metadata: { optimizationSkipped: false, inputBytes, outputBytes }
  };
}
