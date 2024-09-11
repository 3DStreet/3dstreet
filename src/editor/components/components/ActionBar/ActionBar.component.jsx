import { faHand, faPlusSquare } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import styles from './ActionBar.module.scss';
import { Button } from '../Button';
import { useState, useEffect } from 'react';
import posthog from 'posthog-js';
import { Rotate24Icon, Translate24Icon } from '../../../icons';

const ActionBar = ({ handleAddClick, isAddLayerPanelOpen }) => {
  const [cursorEnabled, setCursorEnabled] = useState(
    AFRAME.INSPECTOR.cursor.isPlaying
  );

  const handleHandClick = () => {
    Events.emit('hidecursor');
    posthog.capture('hand_clicked');
    setTransformMode('off');
    setCursorEnabled(false);
  };

  const [transformMode, setTransformMode] = useState('translate'); // "translate" | "rotate" | "scale"
  useEffect(() => {
    // e (rotate) and w (translate) shortcuts
    const onChange = (mode) => {
      setTransformMode(mode);
    };
    Events.on('transformmodechange', onChange);
    return () => {
      Events.off('transformmodechange', onChange);
    };
  }, []);

  const changeTransformMode = (mode) => {
    // mode: "translate" | "rotate" | "scale"
    Events.emit('showcursor');
    Events.emit('transformmodechange', mode);
    posthog.capture('transform_mode_changed', { mode: mode });
    setCursorEnabled(true);
  };

  return (
    <div>
      {!isAddLayerPanelOpen && (
        <div className={styles.wrapper}>
          <Button
            variant="toolbtn"
            className={classNames({ [styles.active]: !cursorEnabled })}
            onClick={handleHandClick}
          >
            <AwesomeIcon icon={faHand} size="2x" />
          </Button>
          <Button
            variant="toolbtn"
            className={classNames({
              [styles.active]: transformMode === 'translate'
            })}
            onClick={() => changeTransformMode('translate')}
          >
            <Translate24Icon className={styles.largeIcon} />
          </Button>
          <Button
            variant="toolbtn"
            className={classNames({
              [styles.active]: transformMode === 'rotate'
            })}
            onClick={() => changeTransformMode('rotate')}
          >
            <Rotate24Icon className={styles.largeIcon} />
          </Button>
          <Button variant="toolbtn" onClick={handleAddClick}>
            <AwesomeIcon icon={faPlusSquare} size="2x" />
          </Button>
        </div>
      )}
    </div>
  );
};

export { ActionBar };
