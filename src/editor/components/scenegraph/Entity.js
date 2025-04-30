/* eslint-disable react/no-danger */
import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import Events from '../../lib/Events';
import { printEntity, removeEntity, cloneEntity } from '../../lib/entity';
import { AwesomeIcon } from '../components/AwesomeIcon';
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
    toggleExpandedCollapsed: PropTypes.func,
    onDragStart: PropTypes.func,
    onDragOver: PropTypes.func,
    onDragEnd: PropTypes.func,
    onDrop: PropTypes.func,
    isDragging: PropTypes.bool,
    isDragOver: PropTypes.bool
  };

  onClick = () => this.props.selectEntity(this.props.entity);

  onDoubleClick = () => Events.emit('objectfocus', this.props.entity.object3D);

  toggleVisibility = () => {
    const entity = this.props.entity;
    const visible =
      entity.tagName.toLowerCase() === 'a-scene'
        ? entity.object3D.visible
        : entity.getAttribute('visible');
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'visible',
      value: !visible
    });
  };

  handleDragStart = (e) => {
    // Only allow dragging if this is not the scene and not a top-level container
    const entity = this.props.entity;
    const tagName = entity.tagName.toLowerCase();
    const isContainer =
      entity.id === 'street-container' ||
      entity.id === 'reference-layers' ||
      entity.id === 'environment';

    if (tagName === 'a-scene' || isContainer) {
      e.preventDefault();
      return false;
    }

    // Set the drag data
    e.dataTransfer.setData('text/plain', this.props.id);
    e.dataTransfer.effectAllowed = 'move';

    // Add a slight delay to make the dragged element semi-transparent
    setTimeout(() => {
      if (this.props.onDragStart) {
        this.props.onDragStart(this.props.entity, this.props.id);
      }
    }, 0);

    return true;
  };

  handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (this.props.onDragOver) {
      this.props.onDragOver(this.props.entity, this.props.id);
    }

    return false;
  };

  handleDragEnter = (e) => {
    e.preventDefault();
    return false;
  };

  handleDragLeave = (e) => {
    e.preventDefault();
    return false;
  };

  handleDrop = (e) => {
    e.preventDefault();

    const sourceId = e.dataTransfer.getData('text/plain');

    if (this.props.onDrop) {
      this.props.onDrop(sourceId, this.props.id, this.props.entity);
    }

    return false;
  };

  handleDragEnd = (e) => {
    if (this.props.onDragEnd) {
      this.props.onDragEnd();
    }

    return false;
  };

  render() {
    const isFiltering = this.props.isFiltering;
    const isExpanded = this.props.isExpanded;
    const entity = this.props.entity;
    const tagName = entity.tagName.toLowerCase();
    const isContainer =
      entity.id === 'street-container' ||
      entity.id === 'reference-layers' ||
      entity.id === 'environment';
    const isDraggable = tagName !== 'a-scene' && !isContainer;

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
          title="Drag to reorder"
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
      active: this.props.isSelected,
      entity: true,
      novisible: !visible,
      option: true,
      'is-dragging': this.props.isDragging,
      'is-drag-over': this.props.isDragOver
    });

    return (
      <div
        className={className}
        onClick={this.onClick}
        onDoubleClick={this.onDoubleClick}
        id={this.props.id}
        draggable={isDraggable}
        onDragStart={this.handleDragStart}
        onDragOver={this.handleDragOver}
        onDragEnter={this.handleDragEnter}
        onDragLeave={this.handleDragLeave}
        onDrop={this.handleDrop}
        onDragEnd={this.handleDragEnd}
        title={isDraggable ? 'Drag to reorder' : null}
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
