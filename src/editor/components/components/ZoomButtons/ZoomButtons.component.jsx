import styles from './ZoomButtons.module.scss';
import { Button } from '../Button';
import classNames from 'classnames';
import { Compass32Icon, SuperHeroIcon } from '../../../icons';
import useStore from '@/store';

/**
 * ZoomButtons component.
 *
 * @author Oleksii Medvediev
 * @category Components
 */
function ZoomButtons() {
  const { isInspectorEnabled, setIsInspectorEnabled } = useStore();

  return (
    <>
      <Button
        id="resetZoomButton"
        className={styles.resetZoomButton}
        variant="toolbtn"
        onPointerDown={() => {
          AFRAME.INSPECTOR.controls.resetZoom();
        }}
      >
        <Compass32Icon />
      </Button>
      <Button
        id="enterViewModeButton"
        className={styles.enterViewModeButton}
        variant="toolbtn"
        onClick={() => setIsInspectorEnabled(!isInspectorEnabled)}
        // what is the right prop name for hover tool tip text?
        title="Enter Viewer Mode"
      >
        <SuperHeroIcon />
      </Button>
      <div className={styles.wrapper}>
        <Button
          id="zoomInButton"
          className={classNames(styles.btn, styles.plusButton)}
          variant="primary"
          onPointerDown={() => {
            AFRAME.INSPECTOR.controls.zoomInStart();
          }}
          onPointerUp={() => {
            AFRAME.INSPECTOR.controls.zoomInStop();
          }}
          onPointerLeave={() => {
            AFRAME.INSPECTOR.controls.zoomInStop();
          }}
        />
        <Button
          id="zoomOutButton"
          className={classNames(styles.btn, styles.minusButton)}
          variant="primary"
          onPointerDown={() => {
            AFRAME.INSPECTOR.controls.zoomOutStart();
          }}
          onPointerUp={() => {
            AFRAME.INSPECTOR.controls.zoomOutStop();
          }}
          onPointerLeave={() => {
            AFRAME.INSPECTOR.controls.zoomOutStop();
          }}
        />
      </div>
    </>
  );
}

export { ZoomButtons };
