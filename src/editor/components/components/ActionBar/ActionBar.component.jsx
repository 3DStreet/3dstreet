import { faHand } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import styles from './ActionBar.module.scss';
import { Button, UnitsPreference, UndoRedo } from '../../components';
import { useState, useEffect, useCallback } from 'react';
import posthog from 'posthog-js';
import { Rotate24Icon, Translate24Icon, Ruler24Icon } from '../../../icons';
import pickPointOnGroundPlane from '../../../lib/pick-point-on-ground-plane';
import {
  fadeInRulerCursorEntity,
  fadeOutRulerCursorEntity,
  fetchOrCreatePreviewMeasureLineEntity
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

  const onRulerMouseUp = useCallback(
    (e) => {
      const previewMeasureLineEl = fetchOrCreatePreviewMeasureLineEntity();
      const mouseUpPosition = pickPointOnGroundPlane({
        x: e.clientX,
        y: e.clientY,
        canvas: AFRAME.scenes[0].canvas,
        camera: AFRAME.INSPECTOR.camera
      });
      if (!hasRulerClicked) {
        previewMeasureLineEl.setAttribute('visible', true);
        // First click logic
        setHasRulerClicked(true);
        previewMeasureLineEl.setAttribute('measure-line', {
          start: mouseUpPosition,
          end: mouseUpPosition
        });
      } else {
        previewMeasureLineEl.setAttribute('visible', false);
        const startPosition =
          previewMeasureLineEl.getAttribute('measure-line').start;
        // Second click logic
        setHasRulerClicked(false);
        // now create a new entity with the measure-line component with the same dimensions
        AFRAME.INSPECTOR.execute('entitycreate', {
          components: {
            'data-layer-name': `Measure Line • ${measureLineCounter}`,
            'measure-line': {
              start: {
                x: startPosition.x,
                y: startPosition.y,
                z: startPosition.z
              },
              end: {
                x: mouseUpPosition.x,
                y: mouseUpPosition.y,
                z: mouseUpPosition.z
              }
            }
          }
        });
        // select the translate tools to show measure line controls
        changeTransformMode('translate');
        setMeasureLineCounter((prev) => prev + 1);
      }
    },
    [hasRulerClicked, measureLineCounter]
  );

  const onRulerMouseMove = useCallback(
    (e) => {
      let rulerCursorEntity = document.getElementById('rulerCursorEntity');
      const position = pickPointOnGroundPlane({
        x: e.clientX,
        y: e.clientY,
        canvas: AFRAME.scenes[0].canvas,
        camera: AFRAME.INSPECTOR.camera
      });
      if (rulerCursorEntity) {
        rulerCursorEntity.object3D.position.copy(position);
      }
      if (hasRulerClicked) {
        // get the previewMeasureLine entity
        const previewMeasureLineEl =
          document.getElementById('previewMeasureLine');
        if (previewMeasureLineEl) {
          previewMeasureLineEl.setAttribute('measure-line', {
            end: position
          });
        }
      }
      return false;
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
      canvas.addEventListener('mousemove', onRulerMouseMove);
      canvas.addEventListener('mouseup', onRulerMouseUp);
      // Add escape key listener
      window.addEventListener('keydown', handleEscapeKey);
    }
    return () => {
      canvas.removeEventListener('mousemove', onRulerMouseMove);
      canvas.removeEventListener('mouseup', onRulerMouseUp);
      window.removeEventListener('keydown', handleEscapeKey);
    };
  }, [newToolMode, onRulerMouseMove, onRulerMouseUp, handleEscapeKey]);

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
        title="Hand Tool - pan and rotate the view without selecting objects"
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
        title="Ruler Tool - Measure distances between points"
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
