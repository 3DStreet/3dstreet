import { faHand } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import styles from './ActionBar.module.scss';
import { Button, UnitsPreference, UndoRedo } from '../../elements';
import { useState, useEffect } from 'react';
import posthog from 'posthog-js';
import { Rotate24Icon, Translate24Icon, Ruler24Icon } from '@shared/icons';
import {
  fadeInRulerCursorEntity,
  fadeOutRulerCursorEntity,
  useRulerTool
} from './RulerAction.jsx';

const ActionBar = ({ selectedEntity }) => {
  const [measureLineCounter, setMeasureLineCounter] = useState(1);
  const [transformMode, setTransformMode] = useState('translate');
  const [newToolMode, setNewToolMode] = useState('off');

  const changeTransformMode = (mode) => {
    Events.emit('showcursor');
    Events.emit('transformmodechange', mode);
    posthog.capture('transform_mode_changed', { mode: mode });
  };

  const { handleRulerMouseUp, handleRulerMouseMove, handleEscapeKey } =
    useRulerTool(
      changeTransformMode,
      measureLineCounter,
      setMeasureLineCounter
    );

  const handleNewToolClick = (tool) => {
    Events.emit('hidecursor');
    posthog.capture(`${tool}_clicked`);
    setTransformMode('off');
    setNewToolMode(tool);

    if (tool === 'ruler') {
      AFRAME.scenes[0].canvas.style.cursor = 'pointer';
      fadeInRulerCursorEntity();
    } else {
      fadeOutRulerCursorEntity();
      AFRAME.scenes[0].canvas.style.cursor = 'grab';
    }
  };

  useEffect(() => {
    const canvas = AFRAME.scenes[0].canvas;
    if (newToolMode === 'ruler') {
      canvas.addEventListener('mousemove', handleRulerMouseMove);
      canvas.addEventListener('mouseup', handleRulerMouseUp);
      window.addEventListener('keydown', handleEscapeKey);
    }
    return () => {
      canvas.removeEventListener('mousemove', handleRulerMouseMove);
      canvas.removeEventListener('mouseup', handleRulerMouseUp);
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [newToolMode, handleRulerMouseMove, handleRulerMouseUp, handleEscapeKey]);

  useEffect(() => {
    const onTransformModeChange = (mode) => {
      setTransformMode(mode);
      setNewToolMode('off');
      AFRAME.scenes[0].canvas.style.cursor = null;
      fadeOutRulerCursorEntity();
      Events.emit('showcursor');
    };

    const onNewToolChange = (tool) => {
      handleNewToolClick(tool);
    };

    Events.on('transformmodechange', onTransformModeChange);
    Events.on('toolchange', onNewToolChange);

    return () => {
      Events.off('transformmodechange', onTransformModeChange);
      Events.off('toolchange', onNewToolChange);
    };
  }, []);

  return (
    <div className={styles.wrapper}>
      <Button
        variant="toolbtn"
        className={classNames({
          [styles.active]:
            newToolMode === 'hand' ||
            selectedEntity?.hasAttribute('data-no-transform')
        })}
        onClick={handleNewToolClick.bind(null, 'hand')}
        title="Hand Tool (h) - pan and rotate the view without selecting objects"
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
        title="Translate Tool (w) - Select and move objects"
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
        title="Rotate Tool (e) - Select and rotate objects"
      >
        <Rotate24Icon />
      </Button>
      <Button
        variant="toolbtn"
        className={classNames({
          [styles.active]: newToolMode === 'ruler'
        })}
        onClick={handleNewToolClick.bind(null, 'ruler')}
        title="Ruler Tool (r) - Measure distances between points"
      >
        <Ruler24Icon />
      </Button>
      <UnitsPreference />
      <div className={styles.divider} />
      <UndoRedo />
    </div>
  );
};

export { ActionBar };
