import PropTypes from 'prop-types';
import { ContextMenu } from 'radix-ui';
import { FormattedMessage } from 'react-intl';
import posthog from 'posthog-js';
import Events from '../../lib/Events';
import {
  copySelectedEntity,
  cutSelectedEntity,
  pasteFromClipboard
} from '../../lib/clipboard.js';
import { canRenameEntity, cloneEntity, removeEntity } from '../../lib/entity';
import { editShortcuts } from '../../lib/editShortcuts.js';
import { commonMessages } from '@/editor/i18n/commonMessages';

/**
 * Right-click context menu for a scene graph row (issue #1947). Wraps the row
 * as the Radix ContextMenu trigger; opening it selects the entity first (via
 * the trigger's contextmenu event), so the clipboard/duplicate/delete actions
 * — which operate on the current selection, exactly like the AppMenu's Edit
 * menu — target the row that was right-clicked. Reuses the AppMenu's Menubar
 * classes so both menus look identical, keyboard hints included.
 */
const EntityContextMenu = ({ entity, onSelectEntity, onRename, children }) => {
  // Cloud-asset entities are excluded from rename like in EntityLabel: their
  // displayed name comes from the Firestore asset, so a data-layer-name
  // rename would not be reflected.
  const canRename = canRenameEntity(entity) && !entity.dataset.assetId;

  const capture = (event) =>
    posthog.capture(event, { source: 'scenegraph_context_menu' });

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild onContextMenu={onSelectEntity}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="MenubarContent"
          // Keep focus where the action put it — Rename mounts an inline
          // input that must not lose focus back to the row on menu close.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <ContextMenu.Item
            className="MenubarItem"
            disabled={!canRename}
            onSelect={() => {
              onRename();
              capture('rename_clicked');
            }}
          >
            <FormattedMessage {...commonMessages.rename} />
          </ContextMenu.Item>
          <ContextMenu.Item
            className="MenubarItem"
            onSelect={() => {
              Events.emit('objectfocus', entity.object3D);
              capture('zoom_to_selection_clicked');
            }}
          >
            <FormattedMessage {...commonMessages.focus} />
            <div className="RightSlot">{editShortcuts.focus}</div>
          </ContextMenu.Item>
          <ContextMenu.Separator className="MenubarSeparator" />
          <ContextMenu.Item
            className="MenubarItem"
            onSelect={() => {
              cutSelectedEntity();
              capture('cut_clicked');
            }}
          >
            <FormattedMessage {...commonMessages.cut} />
            <div className="RightSlot">{editShortcuts.cut}</div>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="MenubarItem"
            onSelect={() => {
              copySelectedEntity();
              capture('copy_clicked');
            }}
          >
            <FormattedMessage {...commonMessages.copy} />
            <div className="RightSlot">{editShortcuts.copy}</div>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="MenubarItem"
            onSelect={() => {
              pasteFromClipboard();
              capture('paste_clicked');
            }}
          >
            <FormattedMessage {...commonMessages.paste} />
            <div className="RightSlot">{editShortcuts.paste}</div>
          </ContextMenu.Item>
          <ContextMenu.Separator className="MenubarSeparator" />
          <ContextMenu.Item
            className="MenubarItem"
            onSelect={() => {
              cloneEntity(entity);
              capture('duplicate_clicked');
            }}
          >
            <FormattedMessage {...commonMessages.duplicate} />
            <div className="RightSlot">{editShortcuts.duplicate}</div>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="MenubarItem"
            onSelect={() => {
              // No confirm prompt: like Cut, the removal is undoable.
              removeEntity(entity, true);
              capture('delete_clicked');
            }}
          >
            <FormattedMessage {...commonMessages.delete} />
            <div className="RightSlot">{editShortcuts.delete}</div>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
};

EntityContextMenu.propTypes = {
  entity: PropTypes.object.isRequired,
  onSelectEntity: PropTypes.func.isRequired,
  onRename: PropTypes.func.isRequired,
  children: PropTypes.node.isRequired
};

export default EntityContextMenu;
