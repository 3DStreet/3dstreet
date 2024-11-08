import { faHand, faPlusSquare } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import styles from './ActionBar.module.scss';
import { Button } from '../Button';
import { useState, useEffect } from 'react';
import posthog from 'posthog-js';
import { Rotate24Icon, Translate24Icon } from '../../../icons';

const ActionBar = ({ handleAddClick, isAddLayerPanelOpen, selectedEntity }) => {
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

  console.log('entity', selectedEntity);
  return (
    <div>
      {!isAddLayerPanelOpen && (
        <div className={styles.wrapper}>
          <Button
            variant="toolbtn"
            className={classNames({
              [styles.active]:
                !cursorEnabled ||
                selectedEntity?.hasAttribute('data-no-transform')
            })}
            onClick={handleHandClick}
          >
            <AwesomeIcon icon={faHand} />
          </Button>
          <Button
            variant="toolbtn"
            className={classNames({
              [styles.active]:
                transformMode === 'translate' &&
                !selectedEntity?.hasAttribute('data-no-transform')
            })}
            onClick={() => changeTransformMode('translate')}
            disabled={selectedEntity?.hasAttribute('data-no-transform')}
          >
            <Translate24Icon />
          </Button>
          <Button
            variant="toolbtn"
            className={classNames({
              [styles.active]:
                transformMode === 'rotate' &&
                !selectedEntity?.hasAttribute('data-no-transform')
            })}
            onClick={() => changeTransformMode('rotate')}
            disabled={selectedEntity?.hasAttribute('data-no-transform')}
          >
            <Rotate24Icon />
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
