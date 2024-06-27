import {
  faHand,
  faHandPointer,
  faPlusSquare
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
        </div>
      )}
    </div>
  );
};

export { ActionBar };
