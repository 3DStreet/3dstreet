import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import Events from '../../lib/Events';
import { printEntity, removeEntity, cloneEntity } from '../../lib/entity';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import {
  faCaretDown,
  faCaretRight,
  faGripVertical
} from '@fortawesome/free-solid-svg-icons';

// Utility function to check if entity is a container (including scene)
export const isContainer = (entity) => {
  return (
    entity.tagName === 'A-SCENE' ||
    entity.id === 'street-container' ||
    entity.id === 'reference-layers' ||
    entity.id === 'environment' ||
    entity.id === 'cameraRig'
  );
};

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
    // Drag and drop props
    draggedEntity: PropTypes.object,
    setDraggedEntity: PropTypes.func,
    hoveredDropTarget: PropTypes.object,
    setHoveredDropTarget: PropTypes.func,
    insertionInfo: PropTypes.object,
    setInsertionInfo: PropTypes.func,
    onReparentEntity: PropTypes.func,
    canBeDragged: PropTypes.func,
    canBeDropTarget: PropTypes.func
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

  // Drag and drop handlers
  onDragStart = (e) => {
    if (!this.props.canBeDragged(this.props.entity)) {
      e.preventDefault();
      return;
    }

    this.props.setDraggedEntity(this.props.entity);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');

    // Hide the drag ghost by setting a transparent image
    const emptyImg = new Image();
    emptyImg.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
    e.dataTransfer.setDragImage(emptyImg, 0, 0);
  };

  onDragEnd = () => {
    this.props.setDraggedEntity(null);
    this.props.setHoveredDropTarget(null);
    this.props.setInsertionInfo(null);
  };

  onDragOver = (e) => {
    if (
      !this.props.canBeDropTarget(this.props.entity, this.props.draggedEntity)
    ) {
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY;
    const midpoint = rect.top + rect.height * 0.5;

    // Currently only "before" and "after" are enabled (reorder within same parent).
    // To re-enable reparenting (dropping as a child of another entity), restore
    // the three-zone layout: top 25% = "before", middle 50% = "child", bottom 25% = "after"
    // and remove the same-parent check in canBeDropTarget in SceneGraph.js.
    let position = null;

    if (!isContainer(this.props.entity)) {
      if (y <= midpoint) {
        const draggedEntity = this.props.draggedEntity;
        const prevSibling = this.props.entity.previousElementSibling;
        if (draggedEntity !== prevSibling) {
          position = 'before';
        }
      } else {
        const draggedEntity = this.props.draggedEntity;
        const nextSibling = this.props.entity.nextElementSibling;
        if (draggedEntity !== nextSibling) {
          position = 'after';
        }
      }
    }

    if (!position) return;

    this.props.setHoveredDropTarget(this.props.entity);
    this.props.setInsertionInfo({ entity: this.props.entity, position });
  };

  onDragLeave = (e) => {
    // Only clear hover state if we're leaving this element entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      this.props.setHoveredDropTarget(null);
      this.props.setInsertionInfo(null);
    }
  };

  onDrop = (e) => {
    e.preventDefault();
    const insertion = this.props.insertionInfo;
    this.props.setHoveredDropTarget(null);
    this.props.setInsertionInfo(null);

    const dragged = this.props.draggedEntity;
    if (
      dragged &&
      this.props.canBeDropTarget(this.props.entity, dragged) &&
      insertion
    ) {
      this.props.onReparentEntity(
        dragged,
        insertion.entity,
        insertion.position
      );
    }
  };

  render() {
    const isFiltering = this.props.isFiltering;
    const isExpanded = this.props.isExpanded;
    const entity = this.props.entity;
    const tagName = entity.tagName.toLowerCase();

    // Drag and drop state
    const isDragging = this.props.draggedEntity === entity;
    const isHoveredDropTarget =
      this.props.hoveredDropTarget === entity &&
      this.props.canBeDropTarget(entity, this.props.draggedEntity);
    const insertionPosition =
      this.props.insertionInfo && this.props.insertionInfo.entity === entity
        ? this.props.insertionInfo.position
        : null;

    // Check if entity can be dragged
    const canBeDragged = this.props.canBeDragged(entity);

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

    // Drag handle - always reserve space for consistent alignment
    const dragHandle = (
      <span
        className={`drag-handle ${canBeDragged ? 'draggable' : 'non-draggable'}`}
        title={canBeDragged ? 'Drag to reorder' : ''}
      >
        {canBeDragged && <AwesomeIcon icon={faGripVertical} size={12} />}
      </span>
    );

    // Class name.
    const className = classNames({
      active: this.props.isSelected,
      entity: true,
      novisible: !visible,
      option: true,
      // Drag and drop classes
      dragging: isDragging,
      'drop-before': isHoveredDropTarget && insertionPosition === 'before',
      'drop-after': isHoveredDropTarget && insertionPosition === 'after'
    });

    return (
      <div
        className={className}
        onClick={this.onClick}
        onDoubleClick={this.onDoubleClick}
        id={this.props.id}
        draggable={canBeDragged}
        onDragStart={this.onDragStart}
        onDragEnd={this.onDragEnd}
        onDragOver={this.onDragOver}
        onDragLeave={this.onDragLeave}
        onDrop={this.onDrop}
      >
        <span>
          <span
            style={{
              width: `${30 * (this.props.depth - 1)}px`
            }}
          />
          {dragHandle}
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
