import React, { useState, useEffect } from 'react';
import styles from './AddLayerPanel.module.scss';
import classNames from 'classnames';
import { Button } from '../Button';
import { Chevron24Down, Load24Icon, Plus20Circle } from '../../../icons';
import { Dropdown } from '../Dropdown';
import CardPlaceholder from '../../../../assets/card-placeholder.svg';
import { cardsData } from './cardsData';
import {
  createSvgExtrudedEntity,
  createMapbox,
  createStreetmixStreet,
  create3DTiles,
  createCustomModel,
  createPrimitiveGeometry
} from './createLayerFunctions';
import Events from '/src/lib/Events';

const AddLayerPanel = ({ onClose, isAddLayerPanelOpen }) => {
  const [selectedOption, setSelectedOption] = useState(null);
  const [groupedMixins, setGroupedMixins] = useState([]);

  useEffect(() => {
    // call getGroupedMixinOptions once time for getting mixinGroups
    const data = getGroupedMixinOptions();
    setGroupedMixins(data);
  }, []);

  // get all mixin data divided into groups, from a-mixin DOM elements
  const getGroupedMixinOptions = () => {
    const mixinElements = document.querySelectorAll('a-mixin');
    const groupedArray = [];
    let categoryName, mixinId;

    const groupedObject = {};
    let index = 0;
    for (const mixinEl of mixinElements) {
      categoryName = mixinEl.getAttribute('category');
      if (!categoryName) continue;
      mixinId = mixinEl.id;
      if (!groupedObject[categoryName]) {
        groupedObject[categoryName] = [];
      }
      groupedObject[categoryName].push({
        // here could be data from dataCards JSON file
        img: '',
        icon: '',
        mixinId: mixinId,
        name: mixinId,
        id: index
      });
      index += 1;
    }

    for (const categoryName of Object.keys(groupedObject)) {
      groupedArray.push({
        label: categoryName,
        options: groupedObject[categoryName]
      });
    }
    return groupedArray;
  };

  const options = [
    {
      value: 'Layers: Streets & Intersections',
      label: 'Layers: Streets & Intersections',
      onClick: () => console.log('Layers: Streets & Intersections')
    },
    {
      value: 'Models: Personal Vehicles',
      label: 'Models: Personal Vehicles',
      mixinGroups: ['vehicles', 'vehicles-rigged'],
      onClick: () => console.log('Models: Personal Vehicles')
    },
    {
      value: 'Models: Transit Vehicles',
      label: 'Models: Transit Vehicles',
      mixinGroups: ['vehicles-transit'],
      onClick: () => console.log('Models: Transit Vehicles')
    },
    {
      value: 'Models: Utility Vehicles',
      label: 'Models: Utility Vehicles',
      mixinGroups: ['vehicles-rigged'],
      onClick: () => console.log('Models: Utility Vehicles')
    },
    {
      value: 'Models: Characters',
      label: 'Models: Characters',
      mixinGroups: ['people', 'people-rigged'],
      onClick: () => console.log('Models: Characters')
    },
    {
      value: 'Models: Street Props',
      label: 'Models: Street Props',
      mixinGroups: ['sidewalk-props', 'intersection-props'],
      onClick: () => console.log('Models: Street Props')
    },
    {
      value: 'Models: dividers',
      label: 'Models: dividers',
      mixinGroups: ['dividers'],
      onClick: () => console.log('Models: dividers')
    },
    {
      value: 'Models: Buildings',
      label: 'Models: Buildings',
      mixinGroups: ['buildings'],
      onClick: () => console.log('Models: Buildings')
    },
    {
      value: 'Models: stencils',
      label: 'Models: stencils',
      mixinGroups: ['stencils'],
      onClick: () => console.log('Models: stencils')
    }
  ];

  // data for layers cards
  const layersData = [
    {
      name: 'Mapbox',
      img: '',
      icon: '',
      description:
        'Create entity with mapbox component, that accepts a long / lat and renders a plane with dimensions that (should be) at a correct scale.',
      id: 1,
      handlerFunction: createMapbox
    },
    {
      name: 'Street from streetmixStreet',
      img: '',
      icon: '',
      description:
        'Create an additional Streetmix street in your 3DStreet scene without replacing any existing streets.',
      id: 2,
      handlerFunction: createStreetmixStreet
    },
    {
      name: 'Entity from extruded SVG',
      img: '',
      icon: '',
      description:
        'Create entity with svg-extruder component, that accepts a svgString and creates a new entity with geometry extruded from the svg and applies the default mixin material grass.',
      id: 3,
      handlerFunction: createSvgExtrudedEntity
    },
    {
      name: '3D Tiles',
      img: '',
      icon: '',
      description:
        'Adds an entity to load and display 3d tiles from Google Maps Tiles API 3D Tiles endpoint. This will break your scene and you cannot save it yet, so beware before testing.',
      id: 4,
      handlerFunction: create3DTiles
    },
    {
      name: 'Create custom model',
      img: '',
      icon: '',
      description:
        'Create entity with model from path for a glTF (or Glb) file hosted on any publicly accessible HTTP server.',
      id: 5,
      handlerFunction: createCustomModel
    },
    {
      name: 'Create primitive geometry',
      img: '',
      icon: '',
      description:
        'Create entity with A-Frame primitive geometry. Geometry type could be changed in properties panel.',
      id: 6,
      handlerFunction: createPrimitiveGeometry
    }
  ];

  // get array with objects data (cardsData) from mixinGroups of selectedOption
  const getSelectedMixinCards = (selectedOption) => {
    if (!selectedOption) return [];
    const selectedOptionData = options.find(
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

  let selectedCards;
  if (selectedOption == 'Layers: Streets & Intersections') {
    selectedCards = layersData;
  } else {
    selectedCards = getSelectedMixinCards(selectedOption);
  }

  const handleSelect = (value) => {
    setSelectedOption(value);
  };

  /* create and preview entity events */

  // entity preview element
  let preEntity = document.createElement('a-entity');
  let selectedObjPos = new THREE.Vector3();
  let segmentElevationPosY = 0;
  // ancestor element in which the added elements will be placed, inside the .custom-group
  let ancestorOfSelectedEl;
  // a flag indicating that the preview entity is inside one of the segments (segment-parent-0, ...)
  let inSegment = false;

  preEntity.setAttribute('visible', false);

  AFRAME.scenes[0].appendChild(preEntity);

  /*
    get the ancestor of element in which the added elements will be placed, inside the .custom-group
    in this order: 
    - ancestor with class segment-parent-..., 
    - elements .street-parent/.buildings-parent,
    - or if the element is a child of a-scene
  */
  const getAncestorEl = (element) => {
    if (element.className.includes('segment-parent')) {
      ancestorOfSelectedEl = element;
      inSegment = true;
    } else if (
      // if there is no segment-parent for element then let Ancestor will be .buildings-parent or .street-parent
      element.classList.contains('street-parent') || 
      element.classList.contains('buildings-parent') ||
      // if we are not in the #street-container and this is the scene child element
      element.parentEl.isScene) {
      ancestorOfSelectedEl = element;
      inSegment = false;
    } else if (element.parentEl) {
      getAncestorEl(element.parentEl);
    }
  };

  const getSegmentElevationPosY = (element) => {
    getAncestorEl(element);
    if (
      ancestorOfSelectedEl &&
      ancestorOfSelectedEl.hasAttribute('data-elevation-posY')
    ) {
      return ancestorOfSelectedEl.getAttribute('data-elevation-posY');
    } else return 0; // default value
  };

  const cardMouseEnter = (mixinId) => {

    preEntity.setAttribute('mixin', mixinId);
    const selectedElement = AFRAME.INSPECTOR.selected?.el;
    if (selectedElement) {
      selectedElement.object3D.getWorldPosition(selectedObjPos);
      // get elevation position Y from attribute of segment element
      segmentElevationPosY = getSegmentElevationPosY(selectedElement);

      // avoid adding preview element inside the direct ancestor of a-scene: #environment, #reference, ...
      if (ancestorOfSelectedEl.parentEl.isScene) return;

      preEntity.setAttribute('visible', true);
      selectedObjPos.setY(segmentElevationPosY);
      if (inSegment) {
        preEntity.setAttribute('position', selectedObjPos);
      } else {
        preEntity.setAttribute('position', {x: selectedObjPos.x, y: 0.2, z: selectedObjPos.z});
      }
    }
  };

  const cardMouseLeave = (mixinId) => {
    preEntity.setAttribute('visible', false);
  };

  const createEntity = (mixinId, parentEl) => {
    console.log('create entity: ', mixinId);
    const newEntity = document.createElement('a-entity');
    newEntity.setAttribute('mixin', mixinId);

    const selectedElement = AFRAME.INSPECTOR.selected?.el;

    // avoid adding new element inside the direct ancestor of a-scene: #environment, #reference, ...
    if (selectedElement && !ancestorOfSelectedEl.parentEl.isScene) {
      // append element as a child of the entity with .custom-group class.
      let customGroupEl = ancestorOfSelectedEl.querySelector('.custom-group');
      if (!customGroupEl) {
        customGroupEl = document.createElement('a-entity');
        // .custom-group entity is a child of segment or .street-parent/.buildings-parent elements
        ancestorOfSelectedEl.appendChild(customGroupEl);
        customGroupEl.classList.add('custom-group');

        if (inSegment) {
          // set position y by elevation level of segment
          customGroupEl.setAttribute('position', { y: segmentElevationPosY });
        } else {
          // if we are creating element not inside segment-parent
          customGroupEl.setAttribute('position', selectedObjPos);
        }
      }
      customGroupEl.appendChild(newEntity);
    } else {
      const streetContainer = document.querySelector('street-container');
      // apppend element as a child of street-container
      if (streetContainer) {
        streetContainer.appendChild(newEntity);
      } else {
        AFRAME.scenes[0].appendChild(newEntity);
      }
    }
    Events.emit('entitycreated', newEntity);
  };

  const cardClick = (card) => {
    if (card.mixinId) {
      createEntity(card.mixinId);
    } else if (card.handlerFunction) {
      card.handlerFunction();
    }
  };
  return (
    <div
      className={classNames(styles.panel, { [styles.open]: isAddLayerPanelOpen })}
    >
      <Button onClick={onClose} variant="custom" className={styles.closeButton}>
        <Chevron24Down />
      </Button>
      <div className={styles.header}>
        <div className={styles.button}>
          <Plus20Circle />
          <p className={styles.buttonLabel}>Add New Entity</p>
        </div>
        <Dropdown
          placeholder="Layers: Maps & Reference"
          options={options}
          onSelect={handleSelect}
          selectedOptionValue={selectedOption}
          className={styles.dropdown}
          smallDropdown={true}
        />
      </div>
      <div className={styles.cards}>
        {selectedCards?.map((card) => (
          <div
            key={card.id}
            className={styles.card}
            onMouseEnter={() => card.mixinId && cardMouseEnter(card.mixinId)}
            onMouseLeave={() => card.mixinId && cardMouseLeave(card.mixinId)}
            onClick={() => cardClick(card)}
            title={card.description}
          >
            <div
              className={styles.img}
              style={{
                backgroundImage: `url(${card.img || CardPlaceholder})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center'
              }}
            />
            <div className={styles.body}>
              {card.icon ? <img src={card.icon} /> : <Load24Icon />}
              <p className={styles.description}>{card.name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export { AddLayerPanel };
