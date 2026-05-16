/**
 * Client-side GLB optimization via gltf-transform.
 *
 * Pipeline:
 *   dedup → instance → palette → flatten → join → weld
 *     → simplify (Meshopt, ratio 0.5, error 0.001)
 *     → resample → prune → sparse
 *     → textureCompress (webp, max 2048×2048, canvas fallback encoder)
 *     → draco (edgebreaker)
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
      const [core, extensions, functions, draco3d, meshopt] = await Promise.all(
        [
          import('@gltf-transform/core'),
          import('@gltf-transform/extensions'),
          import('@gltf-transform/functions'),
          import('draco3dgltf'),
          import('meshoptimizer')
        ]
      );
      const draco3dDefault = draco3d.default || draco3d;
      const [decoderModule, encoderModule] = await Promise.all([
        draco3dDefault.createDecoderModule(),
        draco3dDefault.createEncoderModule()
      ]);
      await meshopt.MeshoptSimplifier.ready;
      return {
        WebIO: core.WebIO,
        ALL_EXTENSIONS: extensions.ALL_EXTENSIONS,
        functions,
        decoderModule,
        encoderModule,
        MeshoptSimplifier: meshopt.MeshoptSimplifier
      };
    })();
  }
  return depsPromise;
}

/**
 * Optimize a GLB file in-browser.
 *
 * @param {File|Blob} file - Source GLB.
 * @returns {Promise<Blob>} Optimized GLB as a binary blob.
 */
export async function optimizeGlb(file) {
  const {
    WebIO,
    ALL_EXTENSIONS,
    functions,
    decoderModule,
    encoderModule,
    MeshoptSimplifier
  } = await loadDeps();

  const {
    dedup,
    instance,
    palette,
    flatten,
    join,
    weld,
    simplify,
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
  const document = await io.readBinary(new Uint8Array(arrayBuffer));

  const transforms = [];
  transforms.push(dedup());
  transforms.push(instance());
  transforms.push(palette());
  transforms.push(flatten());
  transforms.push(join());
  transforms.push(weld());
  transforms.push(
    simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 })
  );
  transforms.push(resample());
  transforms.push(prune());
  transforms.push(sparse());
  transforms.push(
    textureCompress({ targetFormat: 'webp', resize: [2048, 2048] })
  );
  transforms.push(draco({ method: 'edgebreaker' }));

  await document.transform(...transforms);

  const output = await io.writeBinary(document);
  return new Blob([output], { type: 'model/gltf-binary' });
}
