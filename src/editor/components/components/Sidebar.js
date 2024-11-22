import { cloneEntity, removeSelectedEntity } from '../../lib/entity';
import { Button } from '../components';
import ComponentsContainer from './ComponentsContainer';
import Events from '../../lib/Events';
import Mixins from './Mixins';
import PropTypes from 'prop-types';
import React from 'react';
import capitalize from 'lodash-es/capitalize';
import classnames from 'classnames';
import { ArrowRightIcon, LayersIcon } from '../../icons';
import GeoSidebar from './GeoSidebar'; // Make sure to create and import this new component

export default class Sidebar extends React.Component {
  static propTypes = {
    entity: PropTypes.object,
    visible: PropTypes.bool
  };

  constructor(props) {
    super(props);
    this.state = {
      rightBarHide: false
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
    this.setState({ rightBarHide: !this.state.rightBarHide });
  };

  render() {
    const entity = this.props.entity;
    const visible = this.props.visible;
    const className = classnames({
      outliner: true,
      hide: this.state.rightBarHide,
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
          {this.state.rightBarHide ? (
            <>
              <div id="layers-title" onClick={this.toggleRightBar}>
                <div className={'layersBlock'}>
                  <LayersIcon />
                  <span>{entityName || formattedMixin}</span>
                </div>
                <div id="toggle-rightbar">
                  <ArrowRightIcon />
                </div>
              </div>
              <div className="scroll">
                {entity.id !== 'reference-layers' ? (
                  <>
                    {!!entity.mixinEls.length && <Mixins entity={entity} />}
                    {entity.hasAttribute('data-no-transform') ? (
                      <></>
                    ) : (
                      <div id="sidebar-buttons">
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
                    <ComponentsContainer entity={entity} />
                  </>
                ) : (
                  <GeoSidebar entity={entity} />
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
                    <svg
                      width="24"
                      height="28"
                      viewBox="0 0 24 28"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                      className="text-white"
                    >
                      <path
                        d="M1.3335 8.66667L12.0002 2L22.6668 8.66667V19.3333L12.0002 26L1.3335 19.3333V8.66667L12.0002 14.5333V26V14.5333L22.6668 8.66667"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </div>
              </div>
            </>
          )}
          {/* <div id="layers-title" onClick={this.toggleRightBar}> */}
          {/* <span>{entityName || formattedMixin}</span> */}
          {/* <div onClick={this.toggleRightBar} id="toggle-leftbar" /> */}
          {/* </div>
           */}
        </div>
      );
    } else {
      return <div />;
    }
  }
}
