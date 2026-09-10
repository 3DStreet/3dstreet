// OSM click-to-upgrade chip (#1930).
//
// Renders when an empty-space viewport click lands near a streamed OSM
// street way in osm3d mode (see probeOsmWayAtCursor in lib/raycaster.js —
// it fills `osmWayCandidate` in the store). One action: upgrade the
// clicked stretch of the way into real, editable managed streets via the
// osm-streets component (undoable — each chord is an entitycreate on the
// command stack).

import useStore from '@/store';
import styles from './OsmUpgradeChip.module.scss';

const streetsComponent = () =>
  document.querySelector('[osm-streets]')?.components?.['osm-streets'];

export const OsmUpgradeChip = () => {
  const candidate = useStore((state) => state.osmWayCandidate);
  const setOsmWayCandidate = useStore((state) => state.setOsmWayCandidate);
  if (!candidate) return null;

  const label = candidate.class || 'street';

  const upgrade = () => {
    const comp = streetsComponent();
    setOsmWayCandidate(null);
    if (!comp) return;
    const created = comp.upgradeWayAt(candidate.worldPoint);
    if (created > 0) {
      window.STREET?.notify?.successMessage?.(
        `Upgraded OSM ${label} to ${created} editable 3DStreet ${
          created === 1 ? 'street' : 'streets'
        }.`
      );
    }
  };

  return (
    <div className={`clickable ${styles.chip}`}>
      <span className={styles.label}>OSM {label}</span>
      <button className={styles.upgrade} onClick={upgrade}>
        Upgrade to 3DStreet street
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
