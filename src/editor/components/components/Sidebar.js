import { cloneEntity, removeSelectedEntity } from '../../lib/entity';
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
    if (detail.component === 'mixin') {
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

  renderSidebarContent() {
    const { entity } = this.props;

    if (entity.id === 'reference-layers') {
      return <GeoSidebar entity={entity} />;
    }

    if (entity.getAttribute('street-segment')) {
      return (
        <>
          <StreetSegmentSidebar entity={entity} />
          <div className="advancedComponentsContainer">
            <AdvancedComponents entity={entity} />
          </div>
        </>
      );
    }

    if (entity.getAttribute('managed-street')) {
      return (
        <>
          <ManagedStreetSidebar entity={entity} />
          <div className="advancedComponentsContainer">
            <AdvancedComponents entity={entity} />
          </div>
        </>
      );
    }

    const isIntersection = entity.getAttribute('intersection');
    const hasNoTransform = entity.hasAttribute('data-no-transform');

    return (
      <>
        {entity.mixinEls.length > 0 && <Mixins entity={entity} />}

        {!hasNoTransform && (
          <div id="sidebar-buttons">
            <Button variant={'toolbtn'} onClick={() => cloneEntity(entity)}>
              Duplicate
            </Button>
            <Button variant={'toolbtn'} onClick={() => removeSelectedEntity()}>
              Delete
            </Button>
          </div>
        )}

        {isIntersection && <IntersectionSidebar entity={entity} />}
        <ComponentsContainer entity={entity} />
      </>
    );
  }

  renderCollapsedSidebar(entity, displayName) {
    return (
      <div
        onClick={this.toggleRightBar}
        className="relative flex items-center justify-end"
      >
        <div className="group relative flex w-[64px] cursor-pointer items-center justify-end overflow-hidden p-5 transition-[width] transition-colors duration-200 hover:w-auto hover:bg-purple-600 active:bg-purple-800">
          <span className="whitespace-nowrap px-6">{displayName}</span>
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
    );
  }

  render() {
    const { entity, visible } = this.props;

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
      hide: this.state.showSideBar,
      'mt-16': true
    });

    const displayName = entityName || formattedMixin;
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
                <span>{displayName}</span>
              </div>
              <div id="toggle-rightbar">
                <ArrowRightIcon />
              </div>
            </div>
            <div className="scroll">{this.renderSidebarContent()}</div>
          </>
        ) : (
          this.renderCollapsedSidebar(entity, displayName)
        )}
      </div>
    );
  }
}
