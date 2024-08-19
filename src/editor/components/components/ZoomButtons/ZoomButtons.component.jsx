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
        <Button id="resetZoomButton" className={styles.resetZoomButton}>
          <Compass32Icon />
        </Button>
        <div className={styles.wrapper}>
          <Button
            id="zoomInButton"
            className={classNames(styles.btn, styles.plusButton)}
            type="button"
            variant="primary"
          />
          <Button
            id="zoomOutButton"
            className={classNames(styles.btn, styles.minusButton)}
            type="button"
            variant="primary"
          />
        </div>
      </>
    );
  }
}

export { ZoomButtons };
