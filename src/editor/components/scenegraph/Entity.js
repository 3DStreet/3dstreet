/* eslint-disable react/no-danger */
import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import Events from '../../lib/Events';
import {
  printEntity,
  removeEntity,
  cloneEntity,
  getEntityDisplayName
} from '../../lib/entity';
import { AwesomeIcon } from '../components/AwesomeIcon';
import { faCaretDown, faCaretRight } from '@fortawesome/free-solid-svg-icons';
import posthog from 'posthog-js';

export default class Entity extends React.Component {
  static propTypes = {
    depth: PropTypes.number,
    entity: PropTypes.object,
    isExpanded: PropTypes.bool,
    isFiltering: PropTypes.bool,
    isSelected: PropTypes.bool,
    selectedEntity: PropTypes.object,
    children: PropTypes.node
  };

  constructor(props) {
    super(props);
    this.state = {
      isExpanded: this.props.isExpanded,
      isSelected: this.props.isSelected
    };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.isSelected !== this.props.isSelected) {
      this.setState({ isSelected: this.props.isSelected });
    }

    // update expand if entity is selected elsewhere
    if (
      prevProps.isExpanded !== this.props.isExpanded &&
      this.props.isExpanded
    ) {
      this.setState({ isExpanded: this.props.isExpanded });
    }
  }

  onClick = (evt) => {
    const entity = this.props.entity;
    if (!evt.target.classList.contains('fa')) {
      this.setState({ isSelected: true });
      posthog.capture('entity_selected', {
        entity: getEntityDisplayName(entity)
      });
      Events.emit('entityselect', entity, true);
    }
  };

  onDoubleClick = () => Events.emit('objectfocus', this.props.entity.object3D);

  toggleVisibility = (evt) => {
    const entity = this.props.entity;
    const visible =
      entity.tagName.toLowerCase() === 'a-scene'
        ? entity.object3D.visible
        : entity.getAttribute('visible');
    entity.setAttribute('visible', !visible);
    // manually call render function
    this.forceUpdate();
  };

  render() {
    const isFiltering = this.props.isFiltering;
    const entity = this.props.entity;
    const isExpanded = this.state.isExpanded;
    const tagName = entity.tagName.toLowerCase();

    // Clone and remove buttons if not a-scene.
    const cloneButton =
      tagName === 'a-scene' ? null : (
        <a
          onClick={() => cloneEntity(entity)}
          title="Clone entity"
          className="button fa fa-clone"
        />
      );
    const removeButton =
      tagName === 'a-scene' ? null : (
        <a
          onClick={(event) => {
            event.stopPropagation();
            removeEntity(entity);
          }}
          title="Remove entity"
          className="button fa fa-trash"
        />
      );

    let collapse;
    if (entity.children.length > 0 && !isFiltering) {
      collapse = (
        <span
          onClick={(evt) => {
            evt.stopPropagation();
            this.setState({ isExpanded: !isExpanded });
          }}
          className="collapsespace"
        >
          {isExpanded ? (
            <AwesomeIcon icon={faCaretDown} size={16} />
          ) : (
            <AwesomeIcon icon={faCaretRight} size={16} />
          )}
        </span>
      );
    } else {
      collapse = <span className="collapsespace" />;
    }

    // Visibility button.
    const visible =
      tagName === 'a-scene'
        ? entity.object3D.visible
        : entity.getAttribute('visible');
    const visibilityButton = (
      <i
        title="Toggle entity visibility"
        className={'fa ' + (visible ? 'fa-eye' : 'fa-eye-slash')}
        onClick={this.toggleVisibility}
      />
    );

    // Class name.
    const className = classNames({
      active: this.state.isSelected,
      entity: true,
      novisible: !visible,
      option: true
    });

    return (
      <div>
        <div className={className} onClick={this.onClick}>
          <span>
            <span
              style={{
                width: `${30 * this.props.depth}px`
              }}
            />
            {visibilityButton}
            {printEntity(entity, this.onDoubleClick)}
            {collapse}
          </span>
          <span className="entityActions">
            {cloneButton}
            {removeButton}
          </span>
        </div>
        {isExpanded ? this.props.children : null}
      </div>
    );
  }
}
