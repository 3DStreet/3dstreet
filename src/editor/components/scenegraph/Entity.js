/* eslint-disable react/no-danger */
import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import Events from '../../lib/Events';
import { printEntity, removeEntity, cloneEntity } from '../../lib/entity';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { faCaretDown, faCaretRight } from '@fortawesome/free-solid-svg-icons';

export default class Entity extends React.Component {
  static propTypes = {
    id: PropTypes.string,
    depth: PropTypes.number,
    entity: PropTypes.object,
    isExpanded: PropTypes.bool,
    isFiltering: PropTypes.bool,
    isSelected: PropTypes.bool,
    selectEntity: PropTypes.func,
    toggleExpandedCollapsed: PropTypes.func
  };

  onClick = () => this.props.selectEntity(this.props.entity);

  onDoubleClick = () => Events.emit('objectfocus', this.props.entity.object3D);

  toggleVisibility = () => {
    const entity = this.props.entity;
    const visible = entity.object3D.visible;
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'visible',
      value: !visible
    });
  };

  render() {
    const isFiltering = this.props.isFiltering;
    const isExpanded = this.props.isExpanded;
    const entity = this.props.entity;
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
          onClick={() => this.props.toggleExpandedCollapsed(entity)}
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
      collapse = <span />;
    }

    // Visibility button.
    const visible = entity.object3D.visible;
    const visibilityButton = (
      <i
        title="Toggle entity visibility"
        className={'fa ' + (visible ? 'fa-eye' : 'fa-eye-slash')}
        onClick={this.toggleVisibility}
      />
    );

    // Class name.
    const className = classNames({
      active: this.props.isSelected,
      entity: true,
      novisible: !visible,
      option: true
    });

    return (
      <div
        className={className}
        onClick={this.onClick}
        onDoubleClick={this.onDoubleClick}
        id={this.props.id}
      >
        <span>
          <span
            style={{
              width: `${30 * (this.props.depth - 1)}px`
            }}
          />
          {visibilityButton}
          {printEntity(entity)}
          {collapse}
        </span>
        <span className="entityActions">
          {cloneButton}
          {removeButton}
        </span>
      </div>
    );
  }
}
