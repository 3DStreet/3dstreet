// three-node.js — the "few globals shimmed" the task calls for.
//
// GLTFLoader (texture decode) and GLTFExporter (texture encode) both reach for
// a DOM: an <img> element to decode image bytes, a <canvas> to re-encode them,
// and `URL.createObjectURL` to hand the loader a URL for an in-memory Blob.
// None of that exists in Node, so we back it with @napi-rs/canvas (a prebuilt
// Skia canvas) and a tiny object-URL registry. This keeps full source-model
// textures flowing through the assemble→export round trip — no jsdom, no
// browser. Importing this module installs the globals as a side effect; import
// it before any three/examples loader/exporter.

import {
  Image as NapiImage,
  createCanvas,
  ImageData as NapiImageData
} from '@napi-rs/canvas';

// --- object URL registry -------------------------------------------------
// GLTFLoader wraps each embedded image's bufferView in a Blob and calls
// self.URL.createObjectURL(blob). We stash the Blob under a synthetic id and
// resolve it back to bytes when the <img> src is set.
const blobRegistry = new Map();
let blobSeq = 0;

function installURL() {
  if (typeof globalThis.URL.createObjectURL !== 'function') {
    globalThis.URL.createObjectURL = (blob) => {
      const id = `blob:node/${blobSeq++}`;
      blobRegistry.set(id, blob);
      return id;
    };
    globalThis.URL.revokeObjectURL = (id) => {
      blobRegistry.delete(id);
    };
  }
}

async function resolveToBuffer(url) {
  if (typeof url !== 'string') return url;
  if (url.startsWith('blob:node/')) {
    const blob = blobRegistry.get(url);
    if (!blob) throw new Error(`unknown object URL ${url}`);
    return Buffer.from(await blob.arrayBuffer());
  }
  if (url.startsWith('data:')) return url; // napi Image decodes data URLs
  return url; // http(s) — napi Image can fetch; we normally embed instead
}

// Native src setter on the napi Image prototype (accepts a Buffer / data URL
// and decodes synchronously, then invokes .onload).
const nativeImageSrc = Object.getOwnPropertyDescriptor(
  NapiImage.prototype,
  'src'
).set;

// An <img> element good enough for three's ImageLoader: addEventListener/
// removeEventListener('load'|'error') plus an async src setter. The returned
// object IS a napi Image instance, so `instanceof HTMLImageElement` holds in
// GLTFExporter and napi's 2D context can drawImage() it directly.
function makeImage() {
  const img = new NapiImage();
  const listeners = { load: [], error: [] };
  img.addEventListener = (type, cb) => {
    if (listeners[type]) listeners[type].push(cb);
  };
  img.removeEventListener = (type, cb) => {
    if (!listeners[type]) return;
    const i = listeners[type].indexOf(cb);
    if (i >= 0) listeners[type].splice(i, 1);
  };
  img.onload = () => listeners.load.slice().forEach((cb) => cb.call(img));
  img.onerror = (err) =>
    listeners.error.slice().forEach((cb) => cb.call(img, err));
  Object.defineProperty(img, 'src', {
    configurable: true,
    get() {
      return img._src;
    },
    set(value) {
      img._src = value;
      resolveToBuffer(value)
        .then((buffer) => {
          nativeImageSrc.call(img, buffer);
          // napi decodes synchronously; fire load on next microtask so the
          // caller has finished wiring listeners.
          Promise.resolve().then(() => img.onload && img.onload());
        })
        .catch((err) => img.onerror && img.onerror(err));
    }
  });
  return img;
}

// A <canvas> element good enough for GLTFExporter.getCanvas()/processImage:
// width/height, getContext('2d'), and toBlob(). Wraps a napi canvas.
class NodeCanvas {
  constructor(width = 1, height = 1) {
    this._canvas = createCanvas(width, height);
  }
  get width() {
    return this._canvas.width;
  }
  set width(v) {
    this._canvas.width = v;
  }
  get height() {
    return this._canvas.height;
  }
  set height(v) {
    this._canvas.height = v;
  }
  getContext(type, opts) {
    return this._canvas.getContext(type, opts);
  }
  toBlob(callback, mimeType = 'image/png', quality) {
    const buf = this._canvas.toBuffer(mimeType, quality);
    callback(new Blob([buf], { type: mimeType }));
  }
  toDataURL(mimeType, quality) {
    return this._canvas.toDataURL(mimeType, quality);
  }
}

function createElement(name) {
  const tag = String(name).toLowerCase();
  if (tag === 'canvas') return new NodeCanvas();
  if (tag === 'img') return makeImage();
  throw new Error(`three-node document stub: unsupported element <${tag}>`);
}

// GLTFExporter reads each encoded-image Blob back through a FileReader.
class NodeFileReader {
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((ab) => {
        this.result = ab;
        if (this.onloadend) this.onloadend({ target: this });
        if (this.onload) this.onload({ target: this });
      })
      .catch((err) => {
        if (this.onerror) this.onerror(err);
      });
  }
}

export function installDomShims() {
  if (globalThis.__streetToGlbShims) return;
  globalThis.__streetToGlbShims = true;

  installURL();
  globalThis.FileReader = globalThis.FileReader || NodeFileReader;
  globalThis.self = globalThis.self || globalThis;
  globalThis.ImageData = globalThis.ImageData || NapiImageData;
  globalThis.HTMLImageElement = NapiImage;
  globalThis.HTMLCanvasElement = NodeCanvas;

  if (typeof globalThis.document === 'undefined') {
    globalThis.document = {};
  }
  globalThis.document.createElement =
    globalThis.document.createElement || createElement;
  globalThis.document.createElementNS =
    globalThis.document.createElementNS || ((_ns, name) => createElement(name));
}

installDomShims();

// Re-export THREE and the example modules from one place so callers get the
// globals installed before three/examples touches the DOM.
export * as THREE from 'three';
export { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
export { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export { NodeCanvas };
