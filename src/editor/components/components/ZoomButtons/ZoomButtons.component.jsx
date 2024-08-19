import styles from './ZoomButtons.module.scss';
import { Button } from '../Button';
import { Component } from 'react';
import classNames from 'classnames';
import { Compass32Icon } from '../../../icons';

/**
 * ZoomButtons component.
 *
 * @author Oleksii Medvediev
 * @category Components
 */
class ZoomButtons extends Component {
  render() {
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
        <div className={styles.wrapper}>
          <Button
            id="zoomInButton"
            className={classNames(styles.btn, styles.plusButton)}
            type="button"
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
            type="button"
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
}

export { ZoomButtons };
