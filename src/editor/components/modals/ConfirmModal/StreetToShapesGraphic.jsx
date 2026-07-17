import {
  ManagedStreetIcon,
  ArrowRightIcon,
  Object24IconCyan
} from '@shared/icons';
import styles from './StreetToShapesGraphic.module.scss';

/**
 * The visual language for Convert to Shapes: the managed-street icon (the same
 * one shown in the scene graph / sidebar for a managed street) transforming
 * into the default entity "shape" icon (the cube used for every plain entity).
 * Reinforces what the action does — and matches the icons the converted
 * entities will actually use afterward.
 */
export const StreetToShapesGraphic = () => (
  <div className={styles.graphic}>
    <span className={styles.iconTile}>
      <ManagedStreetIcon />
    </span>
    <ArrowRightIcon className={styles.arrow} />
    <span className={styles.iconTile}>
      <Object24IconCyan />
    </span>
  </div>
);
