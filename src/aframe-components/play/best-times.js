/**
 * best-times
 * ==========
 *
 * Local-only best-time storage for play-mode races. Keyed by
 * "<sceneId>::<sceneTitle>" so a saved scene's leaderboard survives
 * across reloads, and an unsaved scene still works under
 * "untitled::<title>" (with the caveat that two unsaved scenes sharing
 * a title share an entry).
 *
 * Storage shape (single localStorage key):
 *   {
 *     [courseKey]: {
 *       bestMs: number,
 *       lastMs: number,
 *       lastImprovedAt: number  // epoch ms
 *     }
 *   }
 *
 * Reads are tolerant of bad/missing JSON; writes are best-effort and
 * swallow quota errors — a missing leaderboard is never fatal.
 */

const STORAGE_KEY = '3dstreet:bestTimes';

export function courseKey(sceneId, sceneTitle) {
  const idPart = sceneId || 'untitled';
  const titlePart = (sceneTitle || 'untitled').toString().trim() || 'untitled';
  return `${idPart}::${titlePart}`;
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) {
    // Quota exceeded or storage disabled. Leaderboard degrades to
    // session-only — not worth surfacing to the user.
  }
}

export function getBest(key) {
  const all = readAll();
  return all[key] || null;
}

/**
 * Record a finished run. Returns { previousBest, isNewBest, deltaMs }
 * so the caller (race-finish handler) can drive the banner UI without
 * a second read.
 */
export function recordFinish(key, finalMs) {
  const all = readAll();
  const prev = all[key] || null;
  const previousBest = prev ? prev.bestMs : null;
  const isNewBest = previousBest === null || finalMs < previousBest;
  const deltaMs = previousBest === null ? 0 : finalMs - previousBest;
  all[key] = {
    bestMs: isNewBest ? finalMs : previousBest,
    lastMs: finalMs,
    lastImprovedAt: isNewBest ? Date.now() : prev.lastImprovedAt || Date.now()
  };
  writeAll(all);
  return { previousBest, isNewBest, deltaMs };
}
