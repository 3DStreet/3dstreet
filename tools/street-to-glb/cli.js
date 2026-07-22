#!/usr/bin/env node
// CLI: street-to-glb <input.json> <output.glb>
//   node cli.js street.json street.glb
// Reads a managed-street JSON payload, writes a GLB.

import { readFileSync, writeFileSync } from 'node:fs';
import { streetToGlbWithMeta } from './index.js';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: node cli.js <input.json> <output.glb>');
  process.exit(1);
}

const payload = JSON.parse(readFileSync(inPath, 'utf8'));
const t0 = Date.now();
const { buffer, meta } = await streetToGlbWithMeta(payload);
writeFileSync(outPath, buffer);
console.error(
  `[street-to-glb] wrote ${outPath} (${buffer.length} bytes, ${meta.segments} segments, ${((Date.now() - t0) / 1000).toFixed(1)}s)`
);
