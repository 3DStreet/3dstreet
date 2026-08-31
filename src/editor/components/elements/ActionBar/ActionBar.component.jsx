import { faHand } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import { captureNavDiscovery } from '../../../lib/navAnalytics.js';
import styles from './ActionBar.module.scss';
import { Button, UnitsPreference, UndoRedo } from '../../elements';
import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import posthog from 'posthog-js';
import {
  Rotate24Icon,
  Translate24Icon,
  ShapeDraw24Icon,
  ZoomIn24Icon,
  ZoomOut24Icon,
  CameraReset24Icon
} from '@shared/icons';
import { useShapeDrawTool } from './ShapeDrawAction.jsx';
import { commonMessages } from '@/editor/i18n/commonMessages';

const ActionBar = ({ selectedEntity }) => {
  const intl = useIntl();
  const [transformMode, setTransformMode] = useState('translate');
  const [newToolMode, setNewToolMode] = useState('off');

  const changeTransformMode = (mode) => {
    Events.emit('showcursor');
    Events.emit('transformmodechange', mode);
    posthog.capture('transform_mode_changed', { mode: mode });
  };

  // Mode is TOOL state, not per-object state: selecting a data-no-transform
  // entity must neither repaint nor lock the toolbar (#1898). The mode
  // buttons stay clickable so the user can still switch translate/rotate
  // with such an entity selected — the gizmo layer independently refuses to
  // attach to no-transform entities — and render dimmed (not disabled) to
  // signal the CURRENT SELECTION can't be transformed.
  const selectionNotTransformable =
    !!selectedEntity?.hasAttribute('data-no-transform');

  // The shape draw tool owns its own canvas listeners + preview via this hook,
  // active whenever the 'shape' tool is selected.
  useShapeDrawTool(changeTransformMode, newToolMode === 'shape');

  const handleNewToolClick = (tool) => {
    Events.emit('hidecursor');
    posthog.capture(`${tool}_clicked`);
    setTransformMode('off');
    setNewToolMode(tool);
    AFRAME.scenes[0].canvas.style.cursor = 'grab';
  };

  useEffect(() => {
    const onTransformModeChange = (mode) => {
      setTransformMode(mode);
      setNewToolMode('off');
      AFRAME.scenes[0].canvas.style.cursor = null;
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
          // Active only when the hand tool is genuinely engaged. Selecting a
          // data-no-transform entity (e.g. an autocreated clone) used to also
          // light this button, which reads as "the hand tool is stuck on" —
          // the translate/rotate buttons below dim instead to signal that
          // the current selection can't be transformed (#1898).
          [styles.active]: newToolMode === 'hand'
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
          [styles.active]: transformMode === 'translate',
          [styles.inapplicable]: selectionNotTransformable
        })}
        onClick={() => changeTransformMode('translate')}
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
          [styles.active]: transformMode === 'rotate',
          [styles.inapplicable]: selectionNotTransformable
        })}
        onClick={() => changeTransformMode('rotate')}
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
          [styles.active]: newToolMode === 'shape'
        })}
        onClick={handleNewToolClick.bind(null, 'shape')}
        title={intl.formatMessage({
          id: 'actionBar.shapeTool',
          defaultMessage:
            'Shape Tool (r) - Measure and draw; click to place points, Enter or double-click to finish, Backspace to remove the last point'
        })}
      >
        <ShapeDraw24Icon />
      </Button>
      <UnitsPreference />
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
        onPointerDown={() => {
          captureNavDiscovery('reset_view');
          AFRAME.INSPECTOR.controls.resetZoom();
        }}
        title={intl.formatMessage(commonMessages.resetCameraView)}
      >
        <CameraReset24Icon />
      </Button>
    </div>
  );
};

export { ActionBar };
