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
import React from 'react';
import capitalize from 'lodash-es/capitalize';
import classnames from 'classnames';
import {
  ArrowRightIcon,
  Object24Icon,
  SegmentIcon,
  ManagedStreetIcon
} from '../../icons';
import GeoSidebar from './GeoSidebar'; // Make sure to create and import this new component
import IntersectionSidebar from './IntersectionSidebar';
import StreetSegmentSidebar from './StreetSegmentSidebar';
import ManagedStreetSidebar from './ManagedStreetSidebar';
import AdvancedComponents from './AdvancedComponents';
export default class Sidebar extends React.Component {
  static propTypes = {
    entity: PropTypes.object,
    visible: PropTypes.bool
  };

  constructor(props) {
    super(props);
    this.state = {
      showSideBar: true
    };
  }

  onEntityUpdate = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    if (
      detail.component === 'mixin' ||
      detail.component === 'data-layer-name'
    ) {
      this.forceUpdate();
    }
  };

  onComponentRemove = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    this.forceUpdate();
  };

  onComponentAdd = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    this.forceUpdate();
  };

  componentDidMount() {
    Events.on('entityupdate', this.onEntityUpdate);
    Events.on('componentremove', this.onComponentRemove);
    Events.on('componentadd', this.onComponentAdd);
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
    Events.off('componentremove', this.onComponentRemove);
    Events.off('componentadd', this.onComponentAdd);
  }

  // additional toggle for hide/show panel by clicking the button
  toggleRightBar = () => {
    this.setState({ showSideBar: !this.state.showSideBar });
  };

  render() {
    const entity = this.props.entity;
    const visible = this.props.visible;
    const className = classnames({
      outliner: true,
      hide: this.state.showSideBar,
      'mt-16': true
    });
    if (entity && visible) {
      const entityName = entity.getDOMAttribute('data-layer-name');
      const entityMixin = entity.getDOMAttribute('mixin');
      const formattedMixin = entityMixin
        ? capitalize(entityMixin.replaceAll('-', ' ').replaceAll('_', ' '))
        : null;
      return (
        <div className={className} tabIndex="0">
          {this.state.showSideBar ? (
            <>
              <div id="layers-title" onClick={this.toggleRightBar}>
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
                onClick={this.toggleRightBar}
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
    } else {
      return <div />;
    }
  }
}
