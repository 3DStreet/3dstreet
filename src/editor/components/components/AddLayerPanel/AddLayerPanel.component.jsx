import { useState, useEffect } from 'react';
import { useAuthContext } from '../../../contexts/index.js';

import styles from './AddLayerPanel.module.scss';
import classNames from 'classnames';
import { Button } from '../Button';
import { Chevron24Down, Plus20Circle } from '../../../icons';
import { Dropdown } from '../Dropdown';
import CardPlaceholder from '../../../../../ui_assets/card-placeholder.svg';
import LockedCard from '../../../../../ui_assets/locked-card.svg';

import { layersData } from './layersData.js';
import { LayersOptions } from './LayersOptions.js';
import mixinCatalog from '../../../../catalog.json';
import posthog from 'posthog-js';
import Events from '../../../lib/Events';

const AddLayerPanel = ({ onClose, isAddLayerPanelOpen }) => {
  // set the first Layers option when opening the panel
  const [selectedOption, setSelectedOption] = useState(LayersOptions[0].value);
  const [groupedMixins, setGroupedMixins] = useState([]);
  const { currentUser } = useAuthContext();
  const isProUser = currentUser && currentUser.isPro;

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

    // convert the mixins array into an object with mixins for faster access by index
    const mixinCatalogObj = mixinCatalog.reduce((obj, item) => {
      obj[item.id] = item;
      return obj;
    }, {});

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

      if (mixinDataFromCatalog) {
        mixinImg = mixinDataFromCatalog.img;
        mixinName = mixinDataFromCatalog.name;
        mixinDescr = mixinDataFromCatalog.description;
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
      groupedObject[categoryName].push(mixinData);
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

  // get array with objects data (cardsData) from mixinGroups of selectedOption
  const getSelectedMixinCards = (selectedOption) => {
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

  let selectedCards;
  if (selectedOption === 'Pro Layers') {
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
      element.parentEl.isScene
    ) {
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
        preEntity.setAttribute('position', {
          x: selectedObjPos.x,
          y: 0.2,
          z: selectedObjPos.z
        });
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
      const streetContainer = document.querySelector('#street-container');
      // apppend element as a child of street-container
      if (streetContainer) {
        streetContainer.appendChild(newEntity);
      } else {
        AFRAME.scenes[0].appendChild(newEntity);
      }
    }
    Events.emit('entitycreated', newEntity);
  };

  const cardClick = (card, isProUser) => {
    posthog.capture('add_layer', {
      layer: card.name,
      requiresPro: card.requiresPro,
      isProUser: isProUser
    });
    if (card.requiresPro && !isProUser) {
      Events.emit('hideAddLayerPanel');
      Events.emit('openpaymentmodal');
    } else if (card.mixinId) {
      createEntity(card.mixinId);
    } else if (card.handlerFunction) {
      card.handlerFunction();
    }
  };
  return (
    <div
      className={classNames(styles.panel, {
        [styles.open]: isAddLayerPanelOpen
      })}
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
          options={LayersOptions}
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
            onClick={() => cardClick(card, isProUser)}
            title={card.description}
          >
            {' '}
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
              {card.icon ? <img src={card.icon} /> : ''}
              <p className={styles.description}>{card.name}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export { AddLayerPanel };
