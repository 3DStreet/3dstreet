import { faHand } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import { captureNavDiscovery } from '../../../lib/navAnalytics.js';
import styles from './ActionBar.module.scss';
import { Button, UnitsPreference, UndoRedo } from '../../elements';
import { useState, useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import posthog from 'posthog-js';
import {
  ShapeDraw24Icon,
  ZoomIn24Icon,
  ZoomOut24Icon,
  CameraReset24Icon
} from '@shared/icons';
import { useShapeDrawTool } from './ShapeDrawAction.jsx';
import { TransformModeMenu } from './TransformModeMenu.jsx';
import { isManagedStreetSegment } from '../../../lib/entity';
import { commonMessages } from '@/editor/i18n/commonMessages';
import {
  DEFAULT_TRANSFORM_MODE,
  nextMoveGizmo
} from '../../../lib/transformModes.js';

const ActionBar = ({ selectedEntity }) => {
  const intl = useIntl();
  // Starts from the viewport's live mode: this bar remounts whenever the
  // inspector reopens, while the viewport keeps its mode.
  const initialMode =
    globalThis.AFRAME?.INSPECTOR?.transformMode ?? DEFAULT_TRANSFORM_MODE;
  const [transformMode, setTransformMode] = useState(initialMode);
  const [newToolMode, setNewToolMode] = useState('off');
  // Read by the `m` cycle, which needs the mode as of the latest event rather
  // than as of the last render.
  const modeRef = useRef(initialMode);

  const changeTransformMode = (mode) => {
    Events.emit('showcursor');
    Events.emit('transformmodechange', mode);
    posthog.capture('transform_mode_changed', { mode: mode });
  };

  // Mode is TOOL state, not per-object state: selecting a data-no-transform
  // entity must neither repaint nor lock the toolbar (#1898). The move tools
  // menu stays usable so the user can still switch move tools with such an
  // entity selected — the gizmo layer independently refuses to attach to
  // no-transform entities — and its button renders dimmed (not disabled) to
  // signal the CURRENT SELECTION can't be transformed. A managed street's
  // segments dim the same way (#1806): street-align owns segment transforms,
  // so the gizmo layer gives them width bars only, no move/rotate gizmo.
  // (Generated street clones carry no such marker: dragging one detaches
  // it, #2011.)
  const selectionNotTransformable =
    !!selectedEntity?.hasAttribute('data-no-transform') ||
    isManagedStreetSegment(selectedEntity);

  // The shape draw tool owns its own canvas listeners + preview via this hook,
  // active whenever the 'shape' tool is selected.
  useShapeDrawTool(changeTransformMode, newToolMode === 'shape');

  const handleNewToolClick = (tool) => {
    Events.emit('hidecursor');
    posthog.capture(`${tool}_clicked`);
    modeRef.current = 'off';
    setTransformMode('off');
    setNewToolMode(tool);
    AFRAME.scenes[0].canvas.style.cursor = 'grab';
  };

  useEffect(() => {
    const onTransformModeChange = (mode) => {
      modeRef.current = mode;
      setTransformMode(mode);
      setNewToolMode('off');
      AFRAME.scenes[0].canvas.style.cursor = null;
      Events.emit('showcursor');
    };

    const onNewToolChange = (tool) => {
      handleNewToolClick(tool);
    };

    // `m` steps through the move gizmos. Only this bar knows when the hand or
    // shape tool is active, and from those, as from scale, it starts at the
    // first.
    const onTransformModeCycle = () => {
      const next = nextMoveGizmo(modeRef.current);
      modeRef.current = next;
      Events.emit('transformmodechange', next);
    };

    Events.on('transformmodechange', onTransformModeChange);
    Events.on('toolchange', onNewToolChange);
    Events.on('transformmodecycle', onTransformModeCycle);

    return () => {
      Events.off('transformmodechange', onTransformModeChange);
      Events.off('toolchange', onNewToolChange);
      Events.off('transformmodecycle', onTransformModeCycle);
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
          // the transform menu below dims instead to signal that
          // the current selection can't be transformed (#1898).
          [styles.active]: newToolMode === 'hand'
        })}
        onClick={() => handleNewToolClick('hand')}
        title={intl.formatMessage({
          id: 'actionBar.handTool',
          defaultMessage:
            'Hand Tool (h) - pan and rotate the view without selecting objects'
        })}
      >
        <AwesomeIcon icon={faHand} />
      </Button>
      <TransformModeMenu
        transformMode={transformMode}
        changeTransformMode={changeTransformMode}
        inapplicable={selectionNotTransformable}
      />
      <Button
        variant="toolbtn"
        className={classNames({
          [styles.active]: newToolMode === 'shape'
        })}
        onClick={() => handleNewToolClick('shape')}
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
