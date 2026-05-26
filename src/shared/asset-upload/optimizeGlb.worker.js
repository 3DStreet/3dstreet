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
    textureCompress,
    draco
  } = functions;

  const io = new WebIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': decoderModule,
      'draco3d.encoder': encoderModule
    });

  const document = await io.readBinary(originalBytes);

  const extensionsUsed = document
    .getRoot()
    .listExtensionsUsed()
    .map((e) => e.extensionName);
  const hasDraco = extensionsUsed.includes('KHR_draco_mesh_compression');
  const hasWebP = extensionsUsed.includes('EXT_texture_webp');
  if (hasDraco && hasWebP) {
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

  if (outputBytes >= inputBytes) {
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

// Heartbeat so the parent log can prove the worker thread is actually
// alive and chewing. Should stop firing the instant the parent calls
// terminate(). If you see heartbeats after the parent logs
// "terminate() returned", the worker wasn't actually killed.
let heartbeatTick = 0;
const heartbeat = setInterval(() => {
  heartbeatTick += 1;
  console.log(`[optimizeGlb worker] alive, tick ${heartbeatTick}`);
}, 1000);

self.addEventListener('message', async (e) => {
  const data = e.data;
  if (!data || data.type !== 'optimize') return;
  console.log(
    `[optimizeGlb worker] received ${data.bytes.byteLength} bytes, optimizing…`
  );
  const t0 = (self.performance || Date).now();
  try {
    const result = await optimize(new Uint8Array(data.bytes));
    const dt = Math.round((self.performance || Date).now() - t0);
    console.log(
      `[optimizeGlb worker] done in ${dt}ms (skipped=${!!result.skipped})`
    );
    clearInterval(heartbeat);
    const transfer =
      result.bytes && result.bytes.buffer ? [result.bytes.buffer] : [];
    self.postMessage({ type: 'result', ...result }, transfer);
  } catch (err) {
    clearInterval(heartbeat);
    self.postMessage({
      type: 'error',
      message: (err && err.message) || String(err)
    });
  }
});
