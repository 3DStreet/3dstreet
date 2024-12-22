import {
  cloneEntity,
  removeSelectedEntity,
  renameEntity
} from '../../lib/entity';
import { Button } from '../components';
import ComponentsContainer from './ComponentsContainer';
import Events from '../../lib/Events';
import Mixins from './Mixins';
import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import capitalize from 'lodash-es/capitalize';
import classnames from 'classnames';
import {
  ArrowRightIcon,
  Object24Icon,
  SegmentIcon,
  ManagedStreetIcon
} from '../../icons';
import GeoSidebar from './GeoSidebar';
import IntersectionSidebar from './IntersectionSidebar';
import StreetSegmentSidebar from './StreetSegmentSidebar';
import ManagedStreetSidebar from './ManagedStreetSidebar';
import AdvancedComponents from './AdvancedComponents';
import { useTheatre } from '../../contexts/TheatreContext';

export default function Sidebar({ entity, visible }) {
  const [showSideBar, setShowSideBar] = useState(true);
  const { addEntityToTheatre, controlledEntities } = useTheatre();

  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity !== entity) {
        return;
      }
      if (
        detail.component === 'mixin' ||
        detail.component === 'data-layer-name'
      ) {
        // Force update happens automatically in functional components
      }
    };

    const onComponentRemove = (detail) => {
      if (detail.entity !== entity) {
        return;
      }
      // Force update happens automatically
    };

    const onComponentAdd = (detail) => {
      if (detail.entity !== entity) {
        return;
      }
      // Force update happens automatically
    };

    Events.on('entityupdate', onEntityUpdate);
    Events.on('componentremove', onComponentRemove);
    Events.on('componentadd', onComponentAdd);

    return () => {
      Events.off('entityupdate', onEntityUpdate);
      Events.off('componentremove', onComponentRemove);
      Events.off('componentadd', onComponentAdd);
    };
  }, [entity]);

  const toggleRightBar = () => {
    setShowSideBar(!showSideBar);
  };

  if (!entity || !visible) {
    return <div />;
  }

  const entityName = entity.getDOMAttribute('data-layer-name');
  const entityMixin = entity.getDOMAttribute('mixin');
  const formattedMixin = entityMixin
    ? capitalize(entityMixin.replaceAll('-', ' ').replaceAll('_', ' '))
    : null;

  const className = classnames({
    outliner: true,
    hide: showSideBar,
    'mt-16': true
  });

  return (
    <div className={className} tabIndex="0">
      {showSideBar ? (
        <>
          <div id="layers-title" onClick={toggleRightBar}>
            <div className={'layersBlock'}>
              {entity.getAttribute('managed-street') ? (
                <ManagedStreetIcon />
              ) : entity.getAttribute('street-segment') ? (
                <SegmentIcon />
              ) : (
                <Object24Icon />
              )}
              <span>{entityName || formattedMixin}</span>
            </div>
            <div id="toggle-rightbar">
              <ArrowRightIcon />
            </div>
          </div>
          <div className="scroll">
            {entity.id !== 'reference-layers' &&
            !entity.getAttribute('street-segment') ? (
              <>
                {!!entity.mixinEls.length && <Mixins entity={entity} />}
                {entity.hasAttribute('data-no-transform') ? (
                  <></>
                ) : (
                  <div id="sidebar-buttons">
                    <Button
                      variant={'toolbtn'}
                      onClick={() => renameEntity(entity)}
                    >
                      Rename
                    </Button>
                    <Button
                      variant={'toolbtn'}
                      onClick={() => cloneEntity(entity)}
                    >
                      Duplicate
                    </Button>
                    <Button
                      variant={'toolbtn'}
                      onClick={() => removeSelectedEntity()}
                    >
                      Delete
                    </Button>
                    <Button
                      variant={'toolbtn'}
                      onClick={() => addEntityToTheatre(entity)}
                      disabled={controlledEntities.has(entity.id)}
                    >
                      {controlledEntities.has(entity.id)
                        ? 'Added to Animation'
                        : 'Add to Animation'}
                    </Button>
                  </div>
                )}
                {entity.getAttribute('intersection') && (
                  <IntersectionSidebar entity={entity} />
                )}
                {entity.getAttribute('managed-street') && (
                  <ManagedStreetSidebar entity={entity} />
                )}
                <ComponentsContainer entity={entity} />
              </>
            ) : (
              <>
                {entity.getAttribute('street-segment') && (
                  <>
                    <StreetSegmentSidebar entity={entity} />
                    <div className="advancedComponentsContainer">
                      <AdvancedComponents entity={entity} />
                    </div>
                  </>
                )}
                {entity.id === 'reference-layers' && (
                  <GeoSidebar entity={entity} />
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div
            onClick={toggleRightBar}
            className="relative flex items-center justify-end"
          >
            <div className="group relative flex cursor-pointer items-center p-2">
              <span className="absolute right-12 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-white opacity-0 transition-all duration-300 group-hover:opacity-100">
                {entityName || formattedMixin}
              </span>
              <div className="relative z-10">
                {entity.getAttribute('managed-street') ? (
                  <ManagedStreetIcon />
                ) : entity.getAttribute('street-segment') ? (
                  <SegmentIcon />
                ) : (
                  <Object24Icon />
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

Sidebar.propTypes = {
  entity: PropTypes.object,
  visible: PropTypes.bool
};
