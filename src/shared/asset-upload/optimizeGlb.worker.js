/**
 * Web Worker that runs the gltf-transform optimization pipeline off the
 * main thread. The main-thread shim in optimizeGlb.js races this worker
 * against a wall-clock timeout and `worker.terminate()`s on bail, so the
 * editor stays responsive even for photogrammetry GLBs that take many
 * seconds to Draco-encode.
 *
 * Protocol:
 *   parent → worker: { type: 'optimize', bytes: ArrayBuffer }  (transferred)
 *   worker → parent: { type: 'result', skipped, reason?, bytes?, outputBytes,
 *                      hadDraco, hadWebP }   (bytes transferred when present)
 *                  | { type: 'error', message }
 *
 * `bytes` on the result is only set when optimization actually produced
 * something smaller, otherwise the parent re-uses the original File.
 *
 * Heavy deps mirror the pre-worker module exactly so behavior is identical.
 * `draco3dgltf`'s Node entry points reference `fs`/`path`; the webpack
 * `resolve.fallback: { fs: false, path: false }` from the parent config
 * applies to worker bundles too.
 */

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian

function isGlbBytes(bytes) {
  if (bytes.byteLength < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true) === GLB_MAGIC;
}

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
      // Draco's Emscripten loader resolves its .wasm via locateFile.
      // In a worker the default resolution lands at a path the dev
      // server can't satisfy (falls through to the SPA index.html →
      // "expected magic word" CompileError). The WASM is copied next
      // to the worker bundle in dist/, so resolve relative to the
      // worker's own URL.
      const locateFile = (file) => new URL(file, self.location.href).href;
      const [decoderModule, encoderModule] = await Promise.all([
        draco3dDefault.createDecoderModule({ locateFile }),
        draco3dDefault.createEncoderModule({ locateFile })
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

async function optimize(originalBytes) {
  const inputBytes = originalBytes.byteLength;
  const { WebIO, ALL_EXTENSIONS, functions, decoderModule, encoderModule } =
    await loadDeps();
  const {
    dedup,
    instance,
    weld,
    resample,
    prune,
    sparse,
    join,
    flatten,
    palette,
    textureCompress,
    draco
  } = functions;

  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': decoderModule,
      'draco3d.encoder': encoderModule
    });

  // Input is either GLB binary or self-contained .gltf JSON (external-ref
  // .gltf is rejected at intake; see analyzeGltf.js). readJSON inlines
  // data: URIs itself, and writeBinary below emits GLB either way — so a
  // .gltf that survives this pipeline uploads as a real GLB.
  let document;
  const wasJson = !isGlbBytes(originalBytes);
  if (wasJson) {
    const json = JSON.parse(new TextDecoder().decode(originalBytes));
    document = await io.readJSON({ json, resources: {} });
  } else {
    document = await io.readBinary(originalBytes);
  }

  const extensionsUsed = document
    .getRoot()
    .listExtensionsUsed()
    .map((e) => e.extensionName);
  const hasDraco = extensionsUsed.includes('KHR_draco_mesh_compression');
  const hasWebP = extensionsUsed.includes('EXT_texture_webp');
  // The skip paths hand the ORIGINAL bytes back to the caller, which is only
  // acceptable when the original is already a GLB. A .gltf JSON input must
  // always come out as converted GLB bytes, so it never takes them.
  if (hasDraco && hasWebP && !wasJson) {
    return {
      skipped: true,
      reason: 'already_optimized',
      outputBytes: inputBytes,
      hadDraco: true,
      hadWebP: true
    };
  }

  await document.transform(
    dedup(),
    instance(),
    flatten(),
    join(),
    weld(),
    resample(),
    prune(),
    sparse(),
    palette({ min: 5 }),
    textureCompress({
      targetFormat: 'webp',
      quality: 0.85,
      resize: [2048, 2048]
    }),
    draco({ method: 'edgebreaker' })
  );

  const output = await io.writeBinary(document);
  const outputBytes = output.byteLength;

  if (outputBytes >= inputBytes && !wasJson) {
    return {
      skipped: true,
      reason: 'not_smaller',
      outputBytes,
      hadDraco: hasDraco,
      hadWebP: hasWebP
    };
  }

  return {
    skipped: false,
    bytes: output,
    outputBytes,
    hadDraco: hasDraco,
    hadWebP: hasWebP
  };
}

self.addEventListener('message', async (e) => {
  const data = e.data;
  if (!data || data.type !== 'optimize') return;
  try {
    const result = await optimize(new Uint8Array(data.bytes));
    const transfer =
      result.bytes && result.bytes.buffer ? [result.bytes.buffer] : [];
    self.postMessage({ type: 'result', ...result }, transfer);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: (err && err.message) || String(err)
    });
  }
});
