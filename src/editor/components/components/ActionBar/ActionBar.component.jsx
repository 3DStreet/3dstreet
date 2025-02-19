import { faHand, faPlusSquare } from '@fortawesome/free-regular-svg-icons';
import { AwesomeIcon } from '../AwesomeIcon';
import classNames from 'classnames';
import Events from '../../../lib/Events';
import styles from './ActionBar.module.scss';
import { Button } from '../Button';
import { useState, useEffect } from 'react';
import posthog from 'posthog-js';
import { Rotate24Icon, Translate24Icon, Ruler24Icon } from '../../../icons';
import useStore from '@/store.js';
import pickPointOnGroundPlane from '../../../lib/pick-point-on-ground-plane';
import { createPortal } from 'react-dom';

const ActionBar = ({ selectedEntity }) => {
  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'addlayer');

  const handleNewToolClick = (tool) => {
    Events.emit('hidecursor'); // objects cannot be hovered and selected
    posthog.capture(`${tool}_clicked`);
    setTransformMode('off');
    setNewToolMode(tool);
    if (tool === 'ruler') {
      // use pick-point-on-ground-plane to get the ground position
      // add on hover event to log the position
      fadeInRulerPreviewEntity();
    } else {
      fadeOutRulerPreviewEntity();
    }
  };

  function fadeInRulerPreviewEntity() {
    let rulerPreviewEntity = document.getElementById('rulerPreviewEntity');
    if (!rulerPreviewEntity) {
      rulerPreviewEntity = document.createElement('a-entity');
      rulerPreviewEntity.setAttribute('id', 'rulerPreviewEntity');
      rulerPreviewEntity.classList.add('hideFromSceneGraph');
      rulerPreviewEntity.innerHTML = `
          <a-ring class="hideFromSceneGraph" id="drop-cursor" rotation="-90 0 0" radius-inner="0.2" radius-outer="0.3">
            <a-ring class="hideFromSceneGraph" color="yellow" radius-inner="0.4" radius-outer="0.5"
              animation="property: scale; from: 1 1 1; to: 2 2 2; loop: true; dir: alternate"></a-ring>
            <a-ring class="hideFromSceneGraph" color="yellow" radius-inner="0.6" radius-outer="0.7"
              animation="property: scale; from: 1 1 1; to: 3 3 3; loop: true; dir: alternate"></a-ring>
            <a-entity class="hideFromSceneGraph" rotation="90 0 0">
              <a-cylinder class="hideFromSceneGraph" color="yellow" position="0 5.25 0" radius="0.05" height="2.5"></a-cylinder>
              <a-cone class="hideFromSceneGraph" color="yellow" position="0 4 0" radius-top="0.5" radius-bottom="0" height="1"></a-cone>
          </a-ring>`;
      AFRAME.scenes[0].appendChild(rulerPreviewEntity);
    }
    rulerPreviewEntity.setAttribute('visible', true);
  }

  function fadeOutRulerPreviewEntity() {
    let rulerPreviewEntity = document.getElementById('rulerPreviewEntity');
    if (rulerPreviewEntity) {
      rulerPreviewEntity.setAttribute('visible', false);
    }
  }

  const fetchOrCreatePreviewMeasureLineEntity = () => {
    let previewMeasureLineEl = document.getElementById('previewMeasureLine');
    if (previewMeasureLineEl) {
      return previewMeasureLineEl;
    }
    // create a new entity with the measure-line component with the same dimensions
    previewMeasureLineEl = document.createElement('a-entity');
    previewMeasureLineEl.setAttribute('id', 'previewMeasureLine');
    previewMeasureLineEl.setAttribute('measure-line', '');
    AFRAME.scenes[0].appendChild(previewMeasureLineEl);
    return previewMeasureLineEl;
  };

  const onRulerMouseUp = (e) => {
    const previewMeasureLineEl = fetchOrCreatePreviewMeasureLineEntity();
    const mouseUpPosition = pickPointOnGroundPlane({
      x: e.clientX,
      y: e.clientY,
      canvas: AFRAME.scenes[0].canvas,
      camera: AFRAME.INSPECTOR.camera
    });
    console.log('onRulerMouseUp');
    console.log('hasRulerClicked:', hasRulerClicked);
    if (!hasRulerClicked) {
      // First click logic
      setHasRulerClicked(true);
      previewMeasureLineEl.setAttribute('measure-line', {
        start: mouseUpPosition,
        end: mouseUpPosition
      });
    } else {
      // Second click logic
      setHasRulerClicked(false);
      // Finish measure-line component...
      // now create a new entity with the measure-line component with the same dimensions
      const startPosition =
        previewMeasureLineEl.getAttribute('measure-line').start;
      AFRAME.INSPECTOR.execute('entitycreate', {
        components: {
          measureLine: {
            start: startPosition,
            end: mouseUpPosition
          }
        }
      });
    }
  };
  const onRulerMouseMove = (e) => {
    let rulerPreviewEntity = document.getElementById('rulerPreviewEntity');
    const position = pickPointOnGroundPlane({
      x: e.clientX,
      y: e.clientY,
      canvas: AFRAME.scenes[0].canvas,
      camera: AFRAME.INSPECTOR.camera
    });
    if (rulerPreviewEntity) {
      rulerPreviewEntity.object3D.position.copy(position);
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
  };

  const [transformMode, setTransformMode] = useState('translate'); // "translate" | "rotate" | "scale"
  const [newToolMode, setNewToolMode] = useState('off'); // "off" | "hand" | "ruler"
  const [hasRulerClicked, setHasRulerClicked] = useState(false);
  useEffect(() => {
    // e (rotate) and w (translate) shortcuts
    const onChange = (mode) => {
      setTransformMode(mode);
      setNewToolMode('off');
      fadeOutRulerPreviewEntity();
      Events.emit('showcursor');
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
  };

  return (
    <div>
      {!isOpen && (
        <div className={styles.wrapper}>
          <Button
            variant="toolbtn"
            className={classNames({
              [styles.active]:
                newToolMode === 'hand' ||
                selectedEntity?.hasAttribute('data-no-transform')
            })}
            onClick={handleNewToolClick.bind(null, 'hand')}
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
          <Button variant="toolbtn" onClick={() => setModal('addlayer')}>
            <AwesomeIcon icon={faPlusSquare} />
          </Button>
          <Button
            variant="toolbtn"
            className={classNames({
              [styles.active]: newToolMode === 'ruler'
            })}
            onClick={handleNewToolClick.bind(null, 'ruler')}
          >
            <Ruler24Icon />
          </Button>
        </div>
      )}
      {newToolMode === 'ruler' &&
        createPortal(
          <div
            onMouseMove={onRulerMouseMove}
            onMouseUp={onRulerMouseUp}
            style={{
              position: 'absolute',
              inset: '0px',
              userSelect: 'none',
              pointerEvents: 'auto'
            }}
          />,
          document.body
        )}
    </div>
  );
};

export { ActionBar };
