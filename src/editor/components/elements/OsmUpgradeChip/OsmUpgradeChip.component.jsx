// OSM "generate street" chip (#1930).
//
// Renders when an empty-space viewport click lands near a streamed OSM
// street way in osm3d mode (see probeOsmWayAtCursor in lib/raycaster.js —
// it fills `osmWayCandidate` in the store). While the chip is up the
// osm-streets component highlights the exact stretch that the one action
// generates: real, editable managed streets via `upgradeWayAt` (undoable —
// each chord is an entitycreate on the command stack).
//
// Copy deliberately avoids "upgrade": in this app that word means the paid
// plan. This is generation, not a purchase.

import { useEffect } from 'react';
import useStore from '@/store';
import styles from './OsmUpgradeChip.module.scss';

const streetsComponent = () =>
  document.querySelector('[osm-streets]')?.components?.['osm-streets'];

export const OsmUpgradeChip = () => {
  const candidate = useStore((state) => state.osmWayCandidate);
  const setOsmWayCandidate = useStore((state) => state.setOsmWayCandidate);

  useEffect(() => {
    const comp = streetsComponent();
    if (!comp) return undefined;
    comp.highlightWayAt(candidate ? candidate.worldPoint : null);
    return () => comp.clearHighlight();
  }, [candidate]);

  if (!candidate) return null;

  const label = candidate.class || 'street';

  const generate = () => {
    const comp = streetsComponent();
    setOsmWayCandidate(null);
    if (!comp) return;
    const created = comp.upgradeWayAt(candidate.worldPoint);
    if (created > 0) {
      window.STREET?.notify?.successMessage?.(
        `Generated ${created} editable 3D ${
          created === 1 ? 'street' : 'streets'
        } from OSM ${label}.`
      );
    }
  };

  return (
    <div className={`clickable ${styles.chip}`}>
      <span className={styles.label}>OSM {label} road</span>
      <button className={styles.generate} onClick={generate}>
        Generate 3D street
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
