// OSM "generate street" chip (#1930).
//
// Renders when an empty-space viewport click lands near a streamed OSM
// street way in osm3d mode (see probeOsmWayAtCursor in lib/raycaster.js —
// it fills `osmWayCandidate` in the store). While the chip is up the
// osm-streets component highlights the exact stretch that the one action
// generates, and asks Overpass for the way's real tags (lanes, sidewalks,
// parking, name) so the chip can say what it found before you commit.
// Generate uses the tags if they've arrived within a short grace, else the
// class rules. Real, editable managed streets via `upgradeWayAt` (undoable
// — each chord is an entitycreate on the command stack).
//
// Copy deliberately avoids "upgrade": in this app that word means the paid
// plan. This is generation, not a purchase.

import { useEffect, useState } from 'react';
import useStore from '@/store';
import { describeFacts } from '@/tested/osm-way-tags.js';
import styles from './OsmUpgradeChip.module.scss';

const streetsComponent = () =>
  document.querySelector('[osm-streets]')?.components?.['osm-streets'];

// How long Generate waits for an in-flight Overpass answer before falling
// back to the class rules.
const GENERATE_GRACE_MS = 1500;

// User-facing copy per osm-streets `lastUpgradeOutcome.reason`.
const BLOCKED_COPY = {
  'no-way': 'No OSM road here',
  'already-generated': 'Street already generated',
  'too-short': 'Too short to generate (min 20 m)',
  'no-piece-long-enough': 'Junctions too close together (min 20 m apart)',
  error: 'Generate failed, see console'
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(undefined), ms))
  ]);

export const OsmUpgradeChip = () => {
  const candidate = useStore((state) => state.osmWayCandidate);
  const setOsmWayCandidate = useStore((state) => state.setOsmWayCandidate);
  // 'loading' | 'ready' | 'none'
  const [detail, setDetail] = useState({ status: 'loading', text: '' });
  // Why a click here can't generate (copy), or null when it can.
  const [blocked, setBlocked] = useState(null);

  // A candidate outlives the layer it was probed from when the map type
  // changes or a new scene loads (the store isn't scene-scoped): drop it
  // rather than leave a chip pointing at a road that is no longer there.
  useEffect(() => {
    if (!candidate) return undefined;
    const clear = () => setOsmWayCandidate(null);
    const scene = AFRAME.scenes[0];
    scene?.addEventListener('newScene', clear);
    const observer = new MutationObserver(() => {
      if (!streetsComponent()) clear();
    });
    if (scene) observer.observe(scene, { childList: true, subtree: true });
    return () => {
      scene?.removeEventListener('newScene', clear);
      observer.disconnect();
    };
  }, [candidate, setOsmWayCandidate]);

  useEffect(() => {
    const comp = streetsComponent();
    if (!candidate) return undefined;
    if (!comp) {
      setOsmWayCandidate(null);
      return undefined;
    }
    comp.highlightWayAt(candidate.worldPoint, { kind: 'selected' });
    const plan = comp.upgradePlanAt(candidate.worldPoint);
    setBlocked(plan.reason === 'ok' ? null : BLOCKED_COPY[plan.reason]);
    let live = true;
    setDetail({ status: 'loading', text: '' });
    comp.hydrateWayAt(candidate.worldPoint).then((result) => {
      if (!live) return;
      setDetail(
        result
          ? { status: 'ready', text: describeFacts(result.facts) }
          : { status: 'none', text: '' }
      );
    });
    return () => {
      live = false;
      comp.clearHighlight('selected');
    };
  }, [candidate, setOsmWayCandidate]);

  if (!candidate) return null;

  const label = candidate.class || 'street';

  const generate = async () => {
    const comp = streetsComponent();
    setOsmWayCandidate(null);
    if (!comp) return;
    const hydrated = await withTimeout(
      comp.hydrateWayAt(candidate.worldPoint),
      GENERATE_GRACE_MS
    );
    const created = comp.upgradeWayAt(candidate.worldPoint, {
      tags: hydrated?.tags || null
    });
    if (created === 0) {
      const reason = comp.lastUpgradeOutcome?.reason;
      window.STREET?.notify?.errorMessage?.(
        BLOCKED_COPY[reason] || BLOCKED_COPY.error
      );
      return;
    }
    if (created > 0) {
      const from = hydrated?.facts?.name ? hydrated.facts.name : `OSM ${label}`;
      window.STREET?.notify?.successMessage?.(
        `Generated ${created} editable 3D ${
          created === 1 ? 'street' : 'streets'
        } from ${from}${hydrated ? ' using OSM tags' : ''}.`
      );
    }
  };

  const detailText =
    blocked ||
    (detail.status === 'loading'
      ? 'Looking up OSM details…'
      : detail.status === 'ready'
        ? detail.text
        : `No OSM detail here, using ${label} defaults`);

  return (
    <div className={`clickable ${styles.chip}`}>
      <div className={styles.text}>
        <span className={styles.label}>OSM {label} road</span>
        <span
          className={`${styles.detail} ${
            detail.status === 'loading' ? styles.pending : ''
          }`}
          title={detailText}
        >
          {detailText}
        </span>
      </div>
      <button
        className={styles.generate}
        onClick={generate}
        disabled={!!blocked}
        title={blocked || undefined}
      >
        Generate Street
      </button>
      <button
        className={styles.dismiss}
        aria-label="Dismiss"
        onClick={() => setOsmWayCandidate(null)}
      >
        ×
      </button>
    </div>
  );
};
