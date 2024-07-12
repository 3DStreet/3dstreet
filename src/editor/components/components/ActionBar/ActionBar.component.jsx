import {
  faHand,
  faHandPointer,
  faPlusSquare,
  faImage
} from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import styles from './ActionBar.module.scss';
import { Button } from '../Button';
import { useState } from 'react';
import posthog from 'posthog-js';

const ActionBar = ({ handleAddClick, isAddLayerPanelOpen }) => {
  const [cursorEnabled, setCursorEnabled] = useState(
    AFRAME.INSPECTOR.cursor.isPlaying
  );

  const handleHandClick = () => {
    Events.emit('hidecursor');
    posthog.capture('hand_clicked');
    setCursorEnabled(false);
  };

  const handleSelectClick = () => {
    Events.emit('showcursor');
    posthog.capture('select_clicked');
    setCursorEnabled(true);
  };

  const handleCameraCLick = () => {
    Events.emit('camera_clicked');
    const screenshotEl = document.getElementById('screenshot');
    screenshotEl.play();

    posthog.capture('screenshot_taken', {
      scene_id: STREET.utils.getCurrentSceneId()
    });

    screenshotEl.setAttribute('screentock', 'type', 'png');
    screenshotEl.setAttribute('screentock', 'takeScreenshot', true);
  };

  return (
    <div>
      {!isAddLayerPanelOpen && (
        <div className={styles.wrapper}>
          <Button
            variant="toolbtn"
            className={classNames({ [styles.active]: cursorEnabled })}
            onClick={handleSelectClick}
          >
            <AwesomeIcon icon={faHandPointer} />
          </Button>
          <Button
            variant="toolbtn"
            className={classNames({ [styles.active]: !cursorEnabled })}
            onClick={handleHandClick}
          >
            <AwesomeIcon icon={faHand} />
          </Button>
          <Button variant="toolbtn" onClick={handleAddClick}>
            <AwesomeIcon icon={faPlusSquare} />
          </Button>
          <Button variant="toolbtn" onClick={handleCameraCLick}>
            <AwesomeIcon icon={faImage} />
          </Button>
        </div>
      )}
    </div>
  );
};

export { ActionBar };
