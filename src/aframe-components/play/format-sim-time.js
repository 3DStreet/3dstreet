// Shared formatter for the play-mode simulation clock. Used by the Viewer
// toolbar pill, the race-finish banner, and play-mode's crash toast / collision
// layer labels so the readout is identical everywhere.
//
// Rounds to centiseconds BEFORE splitting minutes from seconds, so a value like
// 119995ms reads "2:00.00" rather than the illegal "1:60.00" that a naive
// floor(ms/60000) + (ms%60000).toFixed(2) produces at every minute boundary.
export function formatSimTime(ms) {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const minutes = Math.floor(totalCs / 6000);
  const seconds = (totalCs % 6000) / 100;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

// Signed variant for best-time deltas: "+M:SS.CC" / "-M:SS.CC".
export function formatSimDelta(ms) {
  const sign = ms < 0 ? '-' : '+';
  return `${sign}${formatSimTime(Math.abs(ms))}`;
}
