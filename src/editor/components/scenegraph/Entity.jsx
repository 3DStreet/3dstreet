import React from 'react';
import PropTypes from 'prop-types';
import { injectIntl } from 'react-intl';
import classNames from 'classnames';
import Events from '../../lib/Events';
import { removeEntity, cloneEntity, getEntityBadges } from '../../lib/entity';
import { defineMessages } from 'react-intl';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import AssetUploadDot from '../elements/AssetUploadDot';
import EntityContextMenu from './EntityContextMenu';
import EntityLabel from './EntityLabel';
import {
  faCaretDown,
  faCaretRight,
  faEye,
  faEyeSlash,
  faGripVertical
} from '@fortawesome/free-solid-svg-icons';

// Utility function to check if entity is a container (including scene)
export const isContainer = (entity) => {
  return (
    entity.tagName === 'A-SCENE' ||
    entity.id === 'street-container' ||
    entity.id === 'reference-layers' ||
    entity.id === 'environment'
  );
};

// Tooltips for the passive role badges at the right of a row (keys from
// getEntityBadges).
const BADGE_TITLES = defineMessages({
  'focus-hotspot': {
    id: 'entity.badge.focusHotspot',
    defaultMessage:
      'Focus hotspot: clickable in view mode. Click to fly the camera to it.'
  }
});

class Entity extends React.Component {
  static propTypes = {
    intl: PropTypes.object,
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
    canBeDropTarget: PropTypes.func,
    // Context menu rename state (owned by SceneGraph)
    renamingEntity: PropTypes.object,
    setRenamingEntity: PropTypes.func
  };

  onClick = () => this.props.selectEntity(this.props.entity);

  // Select the row being right-clicked before the context menu opens, so the
  // menu's selection-based actions (cut/copy/paste target) apply to it.
  onContextMenu = () => {
    if (!this.props.isSelected) {
      this.props.selectEntity(this.props.entity);
    }
  };

  onDoubleClick = () => Events.emit('objectfocus', this.props.entity.object3D);

  // Badge click: focus the camera on this layer right away (the badge lives
  // inside the clickable row, so don't also toggle selection).
  focusFromBadge = (event) => {
    event.stopPropagation();
    Events.emit('objectfocus', this.props.entity.object3D);
  };

  toggleVisibility = (event) => {
    // The eye lives inside the clickable row — don't also select/focus it.
    event.stopPropagation();
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
    const { intl } = this.props;
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

    // Check if entity can be dragged. Suspended while the row's label is in
    // inline-rename mode so drag-start can't swallow text selection there.
    const isRenaming = this.props.renamingEntity === entity;
    const canBeDragged = this.props.canBeDragged(entity) && !isRenaming;

    // Clone and remove buttons if not a-scene.
    const cloneButton =
      tagName === 'a-scene' || entity.hasAttribute('viewer-start') ? null : (
        <a
          onClick={() => cloneEntity(entity)}
          title={intl.formatMessage({
            id: 'entity.cloneEntity',
            defaultMessage: 'Clone entity'
          })}
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
          title={intl.formatMessage({
            id: 'entity.removeEntity',
            defaultMessage: 'Remove entity'
          })}
          className="button fa fa-trash"
        />
      );

    // Expand/collapse children arrow: left-justified before the name (#1980).
    // Rows without children reserve no space — the name shifts left, an
    // accepted inconsistency for a tighter row.
    let collapse = null;
    if (entity.children.length > 0 && !isFiltering) {
      collapse = (
        <span
          onClick={(event) => {
            event.stopPropagation();
            this.props.toggleExpandedCollapsed(entity);
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
    }

    // Visibility toggle: eye icon in the row's right-justified badge bar,
    // revealed on hover — except a hidden entity's slashed eye, which stays
    // visible as the row's state indicator.
    const visible = entity.object3D.visible;
    const visibilityButton = (
      <button
        type="button"
        title={intl.formatMessage({
          id: 'entity.toggleVisibility',
          defaultMessage: 'Toggle entity visibility'
        })}
        className={
          'entityVisibilityToggle' + (visible ? '' : ' is-entity-hidden')
        }
        onClick={this.toggleVisibility}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <AwesomeIcon icon={visible ? faEye : faEyeSlash} size={12} />
      </button>
    );

    // Drag handle - always reserve space for consistent alignment
    const dragHandle = (
      <span
        className={`drag-handle ${canBeDragged ? 'draggable' : 'non-draggable'}`}
        title={
          canBeDragged
            ? intl.formatMessage({
                id: 'entity.dragToReorder',
                defaultMessage: 'Drag to reorder'
              })
            : ''
        }
      >
        {canBeDragged && <AwesomeIcon icon={faGripVertical} size={12} />}
      </span>
    );

    // Role badges (hotspot target): always visible in the badge bar, in a
    // fixed slot left of the eye; clicking one focuses the layer.
    const badges = getEntityBadges(entity);
    const badgesNode = badges.length ? (
      <span className="entityBadges">
        {badges.map((badge) => (
          <button
            key={badge.key}
            type="button"
            className="entityBadge"
            title={intl.formatMessage(BADGE_TITLES[badge.key])}
            onClick={this.focusFromBadge}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <AwesomeIcon icon={badge.icon} size={12} />
          </button>
        ))}
      </span>
    ) : null;

    // Right-justified badge/toggle bar overlaid on the row (#1980): passive
    // badges first, then the visibility eye (and future animated-control
    // toggles).
    const badgeBar = (
      <span className="entityRowBar">
        {badgesNode}
        {visibilityButton}
      </span>
    );

    // Class name.
    const className = classNames({
      active: this.props.isSelected,
      entity: true,
      novisible: !visible,
      'has-badges': badges.length > 0,
      option: true,
      // Drag and drop classes
      dragging: isDragging,
      'drop-before': isHoveredDropTarget && insertionPosition === 'before',
      'drop-after': isHoveredDropTarget && insertionPosition === 'after'
    });

    return (
      <EntityContextMenu
        entity={entity}
        onSelectEntity={this.onContextMenu}
        onRename={() => this.props.setRenamingEntity(entity)}
      >
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
            {collapse}
            <EntityLabel
              entity={entity}
              forceEditing={isRenaming}
              onEditingEnd={() => this.props.setRenamingEntity(null)}
            />
            <AssetUploadDot entity={entity} />
            {badgeBar}
          </span>
          <span className="entityActions">
            {cloneButton}
            {removeButton}
          </span>
        </div>
      </EntityContextMenu>
    );
  }
}

export default injectIntl(Entity);
