import React from 'react';
import PropTypes from 'prop-types';
import { injectIntl } from 'react-intl';
import classNames from 'classnames';
import Events from '../../lib/Events';
import { removeEntity, cloneEntity, getEntityBadges } from '../../lib/entity';
import { defineMessages } from 'react-intl';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import EntityContextMenu from './EntityContextMenu';
import EntityLabel from './EntityLabel';
import EntityLoadSheen from './EntityLoadSheen';
import { isContainer, isUserGroup } from '../../lib/groups/groupModel.js';
import { LEVEL_INDENT_PX } from './dropLevels.js';
import {
  faCaretDown,
  faCaretRight,
  faEye,
  faEyeSlash,
  faGripVertical
} from '@fortawesome/free-solid-svg-icons';

export { isContainer };

// Where a drop at `fraction` of a row's height (0 = top) would put the dragged
// row. A group row has a middle band that drops into the group; every other row
// splits at its midpoint, so it has no dead middle.
function dropPositionAt(entity, fraction) {
  if (isUserGroup(entity)) {
    if (fraction < 0.25) return 'before';
    if (fraction > 0.75) return 'after';
    return 'child';
  }
  return fraction <= 0.5 ? 'before' : 'after';
}

// Same drop, found by the same row and drawn at the same place: a drag over
// one band re-renders nothing.
function sameInsertion(a, b) {
  return (
    !!a &&
    !!b &&
    a.host === b.host &&
    a.edge === b.edge &&
    a.ref === b.ref &&
    a.position === b.position &&
    a.level === b.level &&
    a.gapY === b.gapY
  );
}

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
    // The drop the pointer means: `ref` and `position` say where it lands.
    // The list draws its line, from `gapY` (the y in the list of the gap the
    // drop is in) and, for a line inside a group, `indentPx`. `host` is the
    // row or the strip whose dragover found the drop, and `edge` the edge of
    // that row the gap is on; both only decide `gapY`.
    insertionInfo: PropTypes.object,
    setInsertionInfo: PropTypes.func,
    // The listed rows ({entity, depth}) just above and below this one, whose
    // gaps with it its upper and lower zones drop into.
    aboveRow: PropTypes.object,
    belowRow: PropTypes.object,
    resolveGroupGap: PropTypes.func,
    isDropLegal: PropTypes.func,
    dropAt: PropTypes.func,
    canBeDragged: PropTypes.func,
    canBeDropTarget: PropTypes.func,
    // A move of this row is still settling: it cannot be dragged meanwhile.
    isMoving: PropTypes.bool,
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

  // What a drop in `zone` of this row would do, or null where none is
  // allowed. The upper and lower zones are the gaps above and below the row;
  // where a gap involves a group level, the pointer's x picks the level.
  insertionAt(zone, clientX, rowLeft) {
    const { entity, draggedEntity } = this.props;
    const edge = { before: 'top', after: 'bottom' }[zone] ?? null;
    if (edge) {
      const row = { entity, depth: this.props.depth };
      const [above, below] =
        edge === 'top'
          ? [this.props.aboveRow, row]
          : [row, this.props.belowRow];
      const groupDrop = this.props.resolveGroupGap(
        above,
        below,
        clientX,
        rowLeft
      );
      // undefined: no group level here; null: none allowed.
      if (groupDrop !== undefined) {
        return groupDrop && { ...groupDrop, host: entity, edge };
      }
    }

    // Drops that would leave the dragged row where it already is.
    if (
      (zone === 'before' && draggedEntity === entity.previousElementSibling) ||
      (zone === 'after' && draggedEntity === entity.nextElementSibling) ||
      (zone === 'child' && draggedEntity.parentNode === entity) ||
      !this.props.canBeDropTarget(entity, draggedEntity, zone)
    ) {
      return null;
    }
    return { ref: entity, position: zone, host: entity, edge, level: null };
  }

  onDragOver = (e) => {
    const { entity, draggedEntity } = this.props;
    if (!draggedEntity || isContainer(entity)) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const zone = dropPositionAt(entity, (e.clientY - rect.top) / rect.height);
    const found = this.insertionAt(zone, e.clientX, rect.left);
    // A drop between rows is placed by its gap's y in the list. Rows sit
    // flush, so this row's bottom is the next row's top: both sides of a gap
    // give the same line.
    const row = e.currentTarget;
    const insertion = found?.edge
      ? {
          ...found,
          gapY:
            found.edge === 'top'
              ? row.offsetTop
              : row.offsetTop + row.offsetHeight
        }
      : found;

    // An illegal zone is not advertised: no preventDefault, so the browser
    // shows the no-drop cursor, and no insertion line.
    if (!insertion) {
      if (this.props.insertionInfo?.host === entity) {
        this.props.setHoveredDropTarget(null);
        this.props.setInsertionInfo(null);
      }
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (this.props.hoveredDropTarget !== entity) {
      this.props.setHoveredDropTarget(entity);
    }
    if (!sameInsertion(this.props.insertionInfo, insertion)) {
      this.props.setInsertionInfo(insertion);
    }
  };

  onDragLeave = (e) => {
    // Only clear hover state if we're leaving this element entirely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    if (
      (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) &&
      this.props.insertionInfo?.host === this.props.entity
    ) {
      this.props.setHoveredDropTarget(null);
      this.props.setInsertionInfo(null);
    }
  };

  onDrop = (e) => {
    e.preventDefault();
    const insertion = this.props.insertionInfo;
    this.props.setHoveredDropTarget(null);
    this.props.setInsertionInfo(null);
    this.props.dropAt(this.props.draggedEntity, insertion);
  };

  render() {
    const { intl } = this.props;
    const isFiltering = this.props.isFiltering;
    const isExpanded = this.props.isExpanded;
    const entity = this.props.entity;
    const tagName = entity.tagName.toLowerCase();

    // Drag and drop state
    const isDragging = this.props.draggedEntity === entity;
    const insertion =
      this.props.insertionInfo?.host === entity
        ? this.props.insertionInfo
        : null;
    const isHoveredDropTarget =
      !!insertion &&
      this.props.hoveredDropTarget === entity &&
      this.props.isDropLegal(insertion, this.props.draggedEntity);

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
      // A drop between rows is drawn by the list, not the row.
      'drop-child': isHoveredDropTarget && insertion.position === 'child'
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
          {/* Ambient load sheen behind the row content (#2009). */}
          <EntityLoadSheen entity={entity} />
          {this.props.isMoving && (
            <span className="entityLoadSheen is-pending" aria-hidden="true" />
          )}
          <span>
            <span
              style={{
                width: `${LEVEL_INDENT_PX * (this.props.depth - 1)}px`
              }}
            />
            {dragHandle}
            {collapse}
            <EntityLabel
              entity={entity}
              forceEditing={isRenaming}
              onEditingEnd={() => this.props.setRenamingEntity(null)}
            />
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
