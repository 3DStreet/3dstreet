import { useState, useEffect, useMemo, useRef } from 'react';
import { Cross24Icon, Plus20Circle } from '../../../icons';
import { createPortal } from 'react-dom';
import { useAuthContext } from '../../../contexts/index.js';
import { Button, Tabs, PanelToggleButton } from '../../components';
import styles from './AddLayerPanel.module.scss';
import classNames from 'classnames';
import CardPlaceholder from '../../../../../ui_assets/card-placeholder.svg';
import LockedCard from '../../../../../ui_assets/locked-card.svg';
import mixinCatalog from '../../../../catalog.json';
import posthog from 'posthog-js';
import pickPointOnGroundPlane from '../../../lib/pick-point-on-ground-plane';
import { customLayersData, streetLayersData } from './layersData.js';
import { LayersOptions } from './LayersOptions.js';
import useStore from '@/store.js';

// Create an empty image
const emptyImg = new Image();
emptyImg.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

// base asset path
const assetBasePath = 'https://assets.3dstreet.app/';

// get all mixin data divided into groups, from a-mixin DOM elements
const getGroupedMixinOptions = () => {
  const mixinElements = document.querySelectorAll('a-mixin');
  const groupedArray = [];
  let categoryName, mixinId;

  // convert the mixins array into an object with mixins for faster access by index
  const mixinCatalogObj = {};
  for (const item of mixinCatalog) {
    mixinCatalogObj[item.id] = item;
  }

  const groupedObject = {};
  let index = 0;
  for (const mixinEl of mixinElements) {
    categoryName = mixinEl.getAttribute('category');
    if (!categoryName) continue;

    if (!groupedObject[categoryName]) {
      groupedObject[categoryName] = [];
    }
    // get mixin data from mixin catalog and push it to object with grouped mixins
    mixinId = mixinEl.id;
    const mixinDataFromCatalog = mixinCatalogObj[mixinId];
    let mixinImg = '';
    let mixinName = '';
    let mixinDescr = '';

    if (mixinDataFromCatalog && mixinDataFromCatalog.display !== 'none') {
      mixinImg = mixinDataFromCatalog.img;
      mixinName = mixinDataFromCatalog.name;
      mixinDescr = mixinDataFromCatalog.description;
    }

    // if mixinImg does not contain http, then prepend the base asset path
    if (!mixinImg.includes('http')) {
      mixinImg = assetBasePath + mixinImg;
    }
    const mixinData = {
      // here could be data from dataCards JSON file
      img: mixinImg,
      icon: '',
      mixinId: mixinId,
      name: mixinName || mixinId,
      description: mixinDescr,
      id: index
    };
    if (mixinDataFromCatalog?.display !== 'none') {
      groupedObject[categoryName].push(mixinData);
    }
    index += 1;
  }

  for (const [categoryName, options] of Object.entries(groupedObject)) {
    groupedArray.push({
      label: categoryName,
      options: options
    });
  }
  return groupedArray;
};

// get array with objects data (cardsData) from mixinGroups of selectedOption
const getSelectedMixinCards = (groupedMixins, selectedOption) => {
  if (!selectedOption) return [];
  const selectedOptionData = LayersOptions.find(
    (option) => option.value === selectedOption
  );
  const selectedMixinGroupNames = selectedOptionData.mixinGroups;

  // there are no mixin groups
  if (!selectedMixinGroupNames) return [];

  // filter selected mixin groups from all mixin groups (groupedMixins)
  const cardsData = groupedMixins
    .filter((group) => selectedMixinGroupNames.includes(group.label))
    .flatMap((mixinGroup) => mixinGroup.options);

  return cardsData;
};

/*
    get the ancestor element in which the added elements will be placed, inside the .custom-group
    in this order:
    - ancestor with class segment-parent-...,
    - elements .street-parent/.buildings-parent,
    - or if the element is a child of a-scene
  */
const getAncestorEl = (element) => {
  if (element.className.includes('segment-parent')) {
    // a flag indicating that the preview entity is inside one of the segments (segment-parent-0, ...)
    const inSegment = true;
    return [element, inSegment];
  } else if (
    // if there is no segment-parent for element then let Ancestor will be .buildings-parent or .street-parent
    element.classList.contains('street-parent') ||
    element.classList.contains('buildings-parent') ||
    // if we are not in the #street-container and this is the scene child element
    element.parentEl.isScene
  ) {
    const inSegment = false;
    return [element, inSegment];
  } else if (element.parentEl) {
    return getAncestorEl(element.parentEl);
  }
};

const getSegmentElevationPosY = (ancestorEl) => {
  if (ancestorEl.hasAttribute('data-elevation-posY')) {
    return ancestorEl.getAttribute('data-elevation-posY');
  } else return 0; // default value
};

const createEntityOnPosition = (mixinId, position) => {
  const previewEntity = document.getElementById('previewEntity');
  if (previewEntity) {
    previewEntity.remove();
  }
  AFRAME.INSPECTOR.execute('entitycreate', {
    mixin: mixinId,
    components: {
      position: position
    }
  });
};

const createEntity = (mixinId) => {
  const previewEntity = document.getElementById('previewEntity');
  if (previewEntity) {
    previewEntity.remove();
  }
  const newEntityObject = {
    mixin: mixinId,
    components: {}
  };

  const selectedElement = AFRAME.INSPECTOR.selectedEntity;
  const [ancestorEl, inSegment] = selectedElement
    ? getAncestorEl(selectedElement)
    : [undefined, false];

  // avoid adding new element inside the direct ancestor of a-scene: #environment, #reference, ...
  if (selectedElement && !ancestorEl.parentEl.isScene) {
    // append element as a child of the entity with .custom-group class.
    let customGroupEl = ancestorEl.querySelector('.custom-group');
    let customGroupCreated = false;
    if (!customGroupEl) {
      customGroupEl = document.createElement('a-entity');
      // .custom-group entity is a child of segment or .street-parent/.buildings-parent elements
      ancestorEl.appendChild(customGroupEl);
      customGroupEl.classList.add('custom-group');
      customGroupCreated = true;
    }
    newEntityObject.parentEl = customGroupEl;

    if (inSegment) {
      // get elevation position Y from attribute of segment element
      const segmentElevationPosY = getSegmentElevationPosY(ancestorEl);
      // set position y by elevation level of segment
      if (customGroupCreated) {
        customGroupEl.setAttribute('position', {
          x: 0,
          y: segmentElevationPosY,
          z: 0
        });
        newEntityObject.components.position = { x: 0, y: 0, z: 0 };
      } else {
        newEntityObject.components.position = {
          x: 0,
          y: segmentElevationPosY,
          z: 0
        };
      }
    } else {
      // if we are creating element not inside segment-parent
      const pos = new THREE.Vector3();
      selectedElement.object3D.getWorldPosition(pos);
      if (customGroupCreated) {
        customGroupEl.object3D.parent.worldToLocal(pos);
      } else {
        customGroupEl.object3D.worldToLocal(pos);
      }
      newEntityObject.components.position = { x: pos.x, y: pos.y, z: pos.z };
    }
  } else {
    const position = pickPointOnGroundPlane({
      normalizedX: 0,
      normalizedY: -0.1,
      camera: AFRAME.INSPECTOR.camera
    });
    newEntityObject.components.position = position;
  }
  AFRAME.INSPECTOR.execute('entitycreate', newEntityObject);
};

const cardMouseEnter = (mixinId) => {
  let previewEntity = document.getElementById('previewEntity');
  if (!previewEntity) {
    previewEntity = document.createElement('a-entity');
    previewEntity.setAttribute('id', 'previewEntity');
    AFRAME.scenes[0].appendChild(previewEntity);
    const dropCursorEntity = document.createElement('a-entity');
    dropCursorEntity.classList.add('hideFromSceneGraph');
    dropCursorEntity.innerHTML = `
      <a-ring class="hideFromSceneGraph" id="drop-cursor" rotation="-90 0 0" radius-inner="0.2" radius-outer="0.3">
        <a-ring class="hideFromSceneGraph" color="yellow" radius-inner="0.4" radius-outer="0.5"
          animation="property: scale; from: 1 1 1; to: 2 2 2; loop: true; dir: alternate"></a-ring>
        <a-ring class="hideFromSceneGraph" color="yellow" radius-inner="0.6" radius-outer="0.7"
          animation="property: scale; from: 1 1 1; to: 3 3 3; loop: true; dir: alternate"></a-ring>
        <a-entity class="hideFromSceneGraph" rotation="90 0 0">
          <a-cylinder class="hideFromSceneGraph" color="yellow" position="0 5.25 0" radius="0.05" height="2.5"></a-cylinder>
          <a-cone class="hideFromSceneGraph" color="yellow" position="0 4 0" radius-top="0.5" radius-bottom="0" height="1"></a-cone>
      </a-ring>`;
    previewEntity.appendChild(dropCursorEntity);
  }

  if (mixinId) {
    previewEntity.setAttribute('mixin', mixinId);

    const selectedElement = AFRAME.INSPECTOR.selectedEntity;
    const [ancestorEl, inSegment] = selectedElement
      ? getAncestorEl(selectedElement)
      : [undefined, false];

    // avoid adding new element inside the direct ancestor of a-scene: #environment, #reference, ...
    if (selectedElement && !ancestorEl.parentEl.isScene) {
      if (inSegment) {
        // get elevation position Y from attribute of segment element
        const segmentElevationPosY = getSegmentElevationPosY(ancestorEl);
        // set position y by elevation level of segment
        ancestorEl.object3D.getWorldPosition(previewEntity.object3D.position);
        previewEntity.object3D.position.y += segmentElevationPosY;
      } else {
        // if we are creating element not inside segment-parent
        selectedElement.object3D.getWorldPosition(
          previewEntity.object3D.position
        );
      }
      return;
    }
  }

  const position = pickPointOnGroundPlane({
    normalizedX: 0,
    normalizedY: -0.1,
    camera: AFRAME.INSPECTOR.camera
  });
  previewEntity.setAttribute('position', position);
};

const cardMouseLeave = (mixinId) => {
  // Note that this is not called when dragging, that's what we want.
  const previewEntity = document.getElementById('previewEntity');
  if (previewEntity) {
    previewEntity.remove();
  }
};

const AddLayerPanel = () => {
  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'addlayer');
  const startCheckout = useStore((state) => state.startCheckout);
  // set the first Layers option when opening the panel
  const [selectedOption, setSelectedOption] = useState(LayersOptions[0].value);
  const [groupedMixins, setGroupedMixins] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef(null);
  const { currentUser } = useAuthContext();
  const isProUser = currentUser && currentUser.isPro;

  const handleDragStart = (e) => {
    console.log('Drag start event:', e);
    console.log('Panel state - isOpen:', isOpen, 'ref:', panelRef.current);

    if (!isOpen) {
      console.log('Panel is not open, ignoring drag');
      return;
    }

    e.preventDefault();
    const rect = panelRef.current.getBoundingClientRect();
    console.log('Initial panel rect:', rect);

    const startHeight = rect.height;
    const startY = e.clientY;
    console.log('Start position - height:', startHeight, 'Y:', startY);

    setIsDragging(true);

    const handleMove = (moveEvent) => {
      console.log('Move event:', moveEvent.clientY);
      if (!panelRef.current) return;

      const deltaY = startY - moveEvent.clientY;
      const newHeight = startHeight + deltaY;
      console.log(
        'Height calculation - delta:',
        deltaY,
        'new height:',
        newHeight
      );

      // Constrain height between min and max values
      const minHeight = 200;
      const maxHeight = window.innerHeight * 0.8;
      const constrainedHeight = Math.max(
        minHeight,
        Math.min(maxHeight, newHeight)
      );
      console.log('Constrained height:', constrainedHeight);

      // Force immediate height update
      panelRef.current.style.height = `${constrainedHeight}px`;
    };

    const handleUp = () => {
      console.log('Mouse up - ending drag');
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };

    console.log('Adding move and up listeners');
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const handleDrag = () => {}; // Keep empty function for cleanup

  const handleDragEnd = () => {
    setIsDragging(false);
    document.removeEventListener('mousemove', handleDrag);
    document.removeEventListener('mouseup', handleDragEnd);
  };

  useEffect(() => {
    return () => {
      // Cleanup event listeners
      document.removeEventListener('mousemove', handleDrag);
      document.removeEventListener('mouseup', handleDragEnd);
    };
  }, []);

  const onClose = () => {
    setModal(null);
  };

  useEffect(() => {
    // call getGroupedMixinOptions once time for getting mixinGroups
    const data = getGroupedMixinOptions();
    setGroupedMixins(data);
  }, []);

  const selectedCards = useMemo(() => {
    switch (selectedOption) {
      case 'Custom Layers':
        return customLayersData;
      case 'Streets and Intersections':
        return streetLayersData;
      default:
        return getSelectedMixinCards(groupedMixins, selectedOption);
    }
  }, [groupedMixins, selectedOption]);

  const handleSelect = (value) => {
    posthog.capture('select_layer_option', {
      layer_option: value
    });
    setSelectedOption(value);
  };

  const cardClick = (card, isProUser) => {
    posthog.capture('add_layer', {
      layer: card.name,
      requiresPro: card.requiresPro,
      isProUser: isProUser
    });
    if (card.requiresPro && !isProUser) {
      startCheckout('addlayer');
    } else if (card.mixinId) {
      createEntity(card.mixinId);
    } else if (card.handlerFunction) {
      card.handlerFunction();
    }
  };

  const dropPlaneEl = useRef(null);

  function fadeInDropPlane() {
    let planeEl = document.getElementById('dropPlane');
    if (!planeEl) {
      planeEl = document.createElement('a-plane');
      planeEl.setAttribute('id', 'dropPlane');
      planeEl.setAttribute('position', '0 0.001 0');
      planeEl.setAttribute('rotation', '-90 0 0');
      planeEl.setAttribute('width', '200');
      planeEl.setAttribute('height', '200');
      planeEl.setAttribute('material', 'color: #1faaf2; opacity: 0.5');
      planeEl.setAttribute('data-ignore-raycaster', '');
      AFRAME.scenes[0].appendChild(planeEl);
    }
    planeEl.setAttribute('visible', 'true');
    dropPlaneEl.current.style.display = 'block';
    dropPlaneEl.current.style.opacity = '0';
  }

  function fadeOutDropPlane() {
    const planeEl = document.getElementById('dropPlane');
    if (planeEl) {
      planeEl.setAttribute('visible', 'false');
    }
    dropPlaneEl.current.style.display = 'none';
    dropPlaneEl.current.style.opacity = '0';
  }

  const onItemDragOver = (e) => {
    if (e.preventDefault) e.preventDefault(); // Necessary. Allows us to drop.
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move'; // See the section on the DataTransfer object.
    }

    const previewEntity = document.getElementById('previewEntity');
    if (previewEntity) {
      previewEntity.setAttribute('visible', true); // we need to set it to true because it's set to false in cardMouseLeave
      const position = pickPointOnGroundPlane({
        x: e.clientX,
        y: e.clientY,
        canvas: AFRAME.scenes[0].canvas,
        camera: AFRAME.INSPECTOR.camera
      });
      previewEntity.object3D.position.copy(position);
    }

    return false;
  };

  const onItemDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // hide dropPlaneEl
    fadeOutDropPlane();

    // get picking point
    const position = pickPointOnGroundPlane({
      x: e.clientX,
      y: e.clientY,
      canvas: AFRAME.scenes[0].canvas,
      camera: AFRAME.INSPECTOR.camera
    });

    // get item data
    if (e.dataTransfer) {
      const transferredData = JSON.parse(
        e.dataTransfer.getData('application/json')
      );
      if (transferredData.mixinId) {
        createEntityOnPosition(transferredData.mixinId, position);
      } else if (transferredData.layerCardId) {
        selectedCards
          .find((card) => card.id === transferredData.layerCardId)
          ?.handlerFunction(position);
      }
    }

    return false;
  };

  return (
    <>
      <PanelToggleButton
        icon={Plus20Circle}
        isOpen={isOpen}
        onClick={() => setModal('addlayer')}
        className={styles.addLayerButton}
      >
        Add New Layer &nbsp;🌳🚦🚗
      </PanelToggleButton>
      <div
        ref={panelRef}
        className={classNames(styles.panel, {
          [styles.open]: isOpen,
          [styles.dragging]: isDragging
        })}
      >
        <div className={styles.dragHandle} onMouseDown={handleDragStart} />
        {createPortal(
          <div
            ref={dropPlaneEl}
            onDragOver={onItemDragOver}
            onDrop={onItemDrop}
            style={{
              display: 'none',
              position: 'absolute',
              inset: '0px',
              userSelect: 'none',
              pointerEvents: 'auto'
            }}
          ></div>,
          document.body
        )}
        <div className={styles.header}>
          <div className={styles.categories}>
            <Tabs
              tabs={LayersOptions.map((option) => ({
                label: option.label,
                value: option.value,
                isSelected: selectedOption === option.value,
                onClick: () => handleSelect(option.value)
              }))}
            />
          </div>
          <Button
            onClick={onClose}
            variant="custom"
            className={styles.closeButton}
          >
            <Cross24Icon />
          </Button>
        </div>

        <div className={styles.contentContainer}>
          <div className={styles.cards}>
            {selectedCards.map((card) => (
              <div
                key={card.id}
                className={styles.card}
                onMouseEnter={() => cardMouseEnter(card.mixinId)}
                onMouseLeave={() => cardMouseLeave(card.mixinId)}
                draggable={true}
                onDragStart={(e) => {
                  const transferData = {
                    mixinId: card.mixinId,
                    layerCardId: card.handlerFunction ? card.id : undefined
                  };
                  e.stopPropagation();
                  if (card.requiresPro && !isProUser) {
                    startCheckout('addlayer');
                    return;
                  }
                  fadeInDropPlane();
                  if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData(
                      'application/json',
                      JSON.stringify(transferData)
                    );
                    // Set the empty image as the drag image
                    e.dataTransfer.setDragImage(emptyImg, 0, 0);
                  }
                  return false;
                }}
                onDragEnd={(e) => {
                  e.stopPropagation();
                  fadeOutDropPlane();
                  return false;
                }}
                onClick={() => cardClick(card, isProUser)}
                title={card.description}
              >
                {card.requiresPro && !isProUser ? (
                  <div
                    className={styles.img}
                    style={{
                      backgroundImage: `url(${LockedCard})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  />
                ) : (
                  <div
                    className={styles.img}
                    style={{
                      backgroundImage: `url(${card.img || CardPlaceholder})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center'
                    }}
                  />
                )}
                <div className={styles.body}>
                  {card.icon ? <img src={card.icon} /> : null}
                  <p className={styles.description}>{card.name}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export { AddLayerPanel };
