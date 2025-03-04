import { faHand } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import styles from './ActionBar.module.scss';
import { Button, UnitsPreference, UndoRedo } from '../../components';
import { useState, useEffect, useCallback } from 'react';
import posthog from 'posthog-js';
import { Rotate24Icon, Translate24Icon, Ruler24Icon } from '../../../icons';
import {
  fadeInRulerCursorEntity,
  fadeOutRulerCursorEntity,
  onRulerMouseUp,
  onRulerMouseMove
} from './RulerAction.jsx';

const ActionBar = ({ selectedEntity }) => {
  const [measureLineCounter, setMeasureLineCounter] = useState(1);

  const handleNewToolClick = (tool) => {
    Events.emit('hidecursor'); // objects cannot be hovered and selected
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

  const [transformMode, setTransformMode] = useState('translate'); // "translate" | "rotate" | "scale"
  const [newToolMode, setNewToolMode] = useState('off'); // "off" | "hand" | "ruler"
  const [hasRulerClicked, setHasRulerClicked] = useState(false);

  const handleRulerMouseUp = useCallback(
    (e) => {
      onRulerMouseUp(
        e,
        hasRulerClicked,
        setHasRulerClicked,
        changeTransformMode,
        measureLineCounter,
        setMeasureLineCounter
      );
    },
    [hasRulerClicked, measureLineCounter]
  );

  const handleRulerMouseMove = useCallback(
    (e) => {
      onRulerMouseMove(e, hasRulerClicked);
    },
    [hasRulerClicked]
  );

  const handleEscapeKey = useCallback(
    (e) => {
      if (e.key === 'Escape' && hasRulerClicked) {
        const previewMeasureLineEl =
          document.getElementById('previewMeasureLine');
        if (previewMeasureLineEl) {
          previewMeasureLineEl.setAttribute('visible', false);
        }
        setHasRulerClicked(false);
      }
    },
    [hasRulerClicked]
  );

  useEffect(() => {
    const canvas = AFRAME.scenes[0].canvas;
    if (newToolMode === 'ruler') {
      canvas.addEventListener('mousemove', handleRulerMouseMove);
      canvas.addEventListener('mouseup', handleRulerMouseUp);
      // Add escape key listener
      window.addEventListener('keydown', handleEscapeKey);
    }
    return () => {
      canvas.removeEventListener('mousemove', handleRulerMouseMove);
      canvas.removeEventListener('mouseup', handleRulerMouseUp);
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [newToolMode, handleRulerMouseMove, handleRulerMouseUp, handleEscapeKey]);

  useEffect(() => {
    // e (rotate) and w (translate) shortcuts
    const onChange = (mode) => {
      setTransformMode(mode);
      setNewToolMode('off');
      // Using null to allow transform controls to manage cursor styles
      AFRAME.scenes[0].canvas.style.cursor = null;
      fadeOutRulerCursorEntity();
      Events.emit('showcursor');
    };

    // Handle remote tool activation
    const onToolChange = (tool) => {
      handleNewToolClick(tool);
    };

    Events.on('transformmodechange', onChange);
    Events.on('toolchange', onToolChange);

    return () => {
      Events.off('transformmodechange', onChange);
      Events.off('toolchange', onToolChange);
    };
  }, []);

  const changeTransformMode = (mode) => {
    // mode: "translate" | "rotate" | "scale"
    Events.emit('showcursor');
    Events.emit('transformmodechange', mode);
    posthog.capture('transform_mode_changed', { mode: mode });
  };

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
