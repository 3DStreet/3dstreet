// Mulberry32 PRNG — byte-for-byte copy of src/lib/rng.js so JSON→GLB is
// deterministic for a fixed seed (needed for the endpoint's content-hash cache).
export function createRNG(seed) {
  return (function (a) {
    return function () {
      var t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })(seed);
}
