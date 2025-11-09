import styles from './ZoomButtons.module.scss';
import { Button } from '../Button';
import classNames from 'classnames';
import { CameraResetIcon } from '@shared/icons';

/**
 * ZoomButtons component.
 *
 * @author Oleksii Medvediev
 * @category Components
 */
function ZoomButtons() {
  return (
    <>
      <Button
        id="resetZoomButton"
        className={styles.resetZoomButton}
        variant="toolbtn"
        onPointerDown={() => {
          AFRAME.INSPECTOR.controls.resetZoom();
        }}
        title="Reset Camera View"
      >
        <CameraResetIcon />
      </Button>
      {/* <Button
        id="enterViewModeButton"
        className={styles.enterViewModeButton}
        variant="toolbtn"
        onClick={() => setIsInspectorEnabled(!isInspectorEnabled)}
        // what is the right prop name for hover tool tip text?
        title="Enter Viewer Mode"
      >
        <SuperHeroIcon />
      </Button> */}
      <div className={styles.wrapper}>
        <Button
          id="zoomInButton"
          className={classNames(styles.btn, styles.plusButton)}
          variant="toolbtn"
          onPointerDown={() => {
            AFRAME.INSPECTOR.controls.zoomInStart();
          }}
          onPointerUp={() => {
            AFRAME.INSPECTOR.controls.zoomInStop();
          }}
          onPointerLeave={() => {
            AFRAME.INSPECTOR.controls.zoomInStop();
          }}
          title="Zoom In"
        />
        <Button
          id="zoomOutButton"
          className={classNames(styles.btn, styles.minusButton)}
          variant="toolbtn"
          onPointerDown={() => {
            AFRAME.INSPECTOR.controls.zoomOutStart();
          }}
          onPointerUp={() => {
            AFRAME.INSPECTOR.controls.zoomOutStop();
          }}
          onPointerLeave={() => {
            AFRAME.INSPECTOR.controls.zoomOutStop();
          }}
          title="Zoom Out"
        />
      </div>
    </>
  );
}

export { ZoomButtons };
