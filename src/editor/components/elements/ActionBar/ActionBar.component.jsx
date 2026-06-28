import { faHand } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import styles from './ActionBar.module.scss';
import {
  Button,
  UnitsPreference,
  LanguagePreference,
  UndoRedo
} from '../../elements';
import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import posthog from 'posthog-js';
import {
  Rotate24Icon,
  Translate24Icon,
  Ruler24Icon,
  ZoomIn24Icon,
  ZoomOut24Icon,
  CameraReset24Icon
} from '@shared/icons';
import {
  fadeInRulerCursorEntity,
  fadeOutRulerCursorEntity,
  useRulerTool
} from './RulerAction.jsx';

const ActionBar = ({ selectedEntity }) => {
  const intl = useIntl();
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
        title={intl.formatMessage({
          id: 'actionBar.handTool',
          defaultMessage:
            'Hand Tool (h) - pan and rotate the view without selecting objects'
        })}
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
        title={intl.formatMessage({
          id: 'actionBar.translateTool',
          defaultMessage: 'Translate Tool (w) - Select and move objects'
        })}
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
        title={intl.formatMessage({
          id: 'actionBar.rotateTool',
          defaultMessage: 'Rotate Tool (e) - Select and rotate objects'
        })}
      >
        <Rotate24Icon />
      </Button>
      <Button
        variant="toolbtn"
        className={classNames({
          [styles.active]: newToolMode === 'ruler'
        })}
        onClick={handleNewToolClick.bind(null, 'ruler')}
        title={intl.formatMessage({
          id: 'actionBar.rulerTool',
          defaultMessage: 'Ruler Tool (r) - Measure distances between points'
        })}
      >
        <Ruler24Icon />
      </Button>
      <UnitsPreference />
      <LanguagePreference />
      <div className={styles.divider} />
      <UndoRedo />
      <Button
        variant="toolbtn"
        onPointerDown={() => AFRAME.INSPECTOR.controls.zoomOutStart()}
        onPointerUp={() => AFRAME.INSPECTOR.controls.zoomOutStop()}
        onPointerLeave={() => AFRAME.INSPECTOR.controls.zoomOutStop()}
        title={intl.formatMessage({
          id: 'actionBar.zoomOut',
          defaultMessage: 'Zoom Out'
        })}
      >
        <ZoomOut24Icon />
      </Button>
      <Button
        variant="toolbtn"
        onPointerDown={() => AFRAME.INSPECTOR.controls.zoomInStart()}
        onPointerUp={() => AFRAME.INSPECTOR.controls.zoomInStop()}
        onPointerLeave={() => AFRAME.INSPECTOR.controls.zoomInStop()}
        title={intl.formatMessage({
          id: 'actionBar.zoomIn',
          defaultMessage: 'Zoom In'
        })}
      >
        <ZoomIn24Icon />
      </Button>
      <Button
        variant="toolbtn"
        onPointerDown={() => AFRAME.INSPECTOR.controls.resetZoom()}
        title={intl.formatMessage({
          id: 'actionBar.resetCameraView',
          defaultMessage: 'Reset Camera View'
        })}
      >
        <CameraReset24Icon />
      </Button>
    </div>
  );
};

export { ActionBar };
