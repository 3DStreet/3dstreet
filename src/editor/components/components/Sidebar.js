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
import { sendMetric } from '../../services/ga';
export default class Sidebar extends React.Component {
  static propTypes = {
    entity: PropTypes.object,
    visible: PropTypes.bool
  };

  constructor(props) {
    super(props);
    this.state = {
      open: false,
      rightBarHide: false
    };
  }

  componentDidMount() {
    Events.on('entityupdate', (detail) => {
      if (detail.entity !== this.props.entity) {
        return;
      }
      if (detail.component === 'mixin') {
        this.forceUpdate();
      }
    });

    Events.on('componentremove', (event) => {
      this.forceUpdate();
    });
    Events.on('componentadd', (event) => {
      this.forceUpdate();
    });
  }
  // additional toggle for hide/show panel by clicking the button

  toggleRightBar = () => {
    this.setState({ rightBarHide: !this.state.rightBarHide });
  };

  handleToggle = () => {
    this.setState({ open: !this.state.open });
    sendMetric('Components', 'toggleSidebar');
  };

  render() {
    const entity = this.props.entity;
    const visible = this.props.visible;
    // Rightbar class names
    const className = classnames({
      outliner: true,
      hide: this.state.rightBarHide
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
                {!!entity.mixinEls.length && <Mixins entity={entity} />}
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
                <ComponentsContainer entity={entity} />
              </div>
            </>
          ) : (
            <>
              <li onClick={this.toggleRightBar}>
                <a className="camera" href="#">
                  <span className="title" title={entityName || formattedMixin}>
                    {entityName || formattedMixin}
                  </span>
                  <div className="icon">
                    <svg
                      width="24"
                      height="28"
                      viewBox="0 0 24 28"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M1.3335 8.66667L12.0002 2L22.6668 8.66667V19.3333L12.0002 26L1.3335 19.3333V8.66667L12.0002 14.5333V26V14.5333L22.6668 8.66667"
                        stroke="white"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                </a>
              </li>
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
