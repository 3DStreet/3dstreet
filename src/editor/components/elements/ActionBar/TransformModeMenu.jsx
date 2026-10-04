import { useEffect, useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import classNames from 'classnames';
import { defineMessages, useIntl } from 'react-intl';
import Events from '../../../lib/Events';
import { Button } from '../../elements';
import {
  DEFAULT_TRANSFORM_MODE,
  MOVE_GIZMO_MODES
} from '../../../lib/transformModes.js';
import styles from './ActionBar.module.scss';
import '../../../style/AppMenu.scss';
import {
  Rotate24Icon,
  Translate24Icon,
  EasyTransform24Icon
} from '@shared/icons';

/**
 * The transform-mode control, collapsed into one button with a flyout, so a
 * third mode can be added without a third slot on a bottom-centred dock.
 *
 * Styled with the app menu's own classes, which the entity context menu already
 * reuses for the same reason: two menus in one editor should look like one
 * thing.
 */

const ICONS = {
  translate: Translate24Icon,
  rotate: Rotate24Icon,
  easy: EasyTransform24Icon
};

const LABELS = defineMessages({
  easy: {
    id: 'actionBar.transformMenu.easy',
    defaultMessage: 'Move'
  },
  translate: {
    id: 'actionBar.transformMenu.translate',
    defaultMessage: 'Advanced move'
  },
  rotate: {
    id: 'actionBar.transformMenu.rotate',
    defaultMessage: 'Advanced rotate'
  }
});

const TransformModeMenu = ({
  transformMode,
  changeTransformMode,
  inapplicable
}) => {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  // Keep the last representable mode while hand, shape or scale is active.
  const [lastMode, setLastMode] = useState(() =>
    ICONS[transformMode] ? transformMode : DEFAULT_TRANSFORM_MODE
  );

  useEffect(() => {
    if (ICONS[transformMode]) setLastMode(transformMode);
  }, [transformMode]);

  useEffect(() => {
    // Not the outside press: a selection can arrive from the layers panel, from
    // the AI chat or from an undo, none of which is a click on this menu.
    const close = () => setOpen(false);
    Events.on('objectselect', close);
    return () => {
      Events.off('objectselect', close);
    };
  }, []);

  // Escape closes the flyout on KEYDOWN, while the editor's deselect runs on
  // keyup — different phases, so the dismissal cannot suppress it, and backing
  // out of the menu would throw away the selection the user opened it to
  // transform. Swallow exactly the one keyup that follows.
  const onEscapeKeyDown = () => {
    const swallow = (event) => {
      window.removeEventListener('keyup', swallow, true);
      if (event.key === 'Escape') event.stopPropagation();
    };
    window.addEventListener('keyup', swallow, true);
  };

  const Icon = ICONS[lastMode];
  const active = !!ICONS[transformMode];

  // While hand, shape or scale is active, pressing the button switches
  // straight back to the last move tool; the flyout opens only on a press
  // made while a move tool is already active.
  const onOpenChange = (next) => {
    if (next && !active) {
      changeTransformMode(lastMode);
      return;
    }
    setOpen(next);
  };

  return (
    // Explicitly non-modal. A modal menu puts pointer-events: none on the rest
    // of the document and consumes the dismissing outside press, so selecting an
    // object while this is open would cost two clicks — and this is the first
    // menu in the editor whose dismissal region is the viewport.
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button
          variant="toolbtn"
          className={classNames(styles.menuTrigger, {
            [styles.active]: active,
            // Mode is TOOL state, not per-object state: the button stays
            // clickable with a non-transformable entity selected and dims to
            // say the current selection will not be acted on. The gizmo layer
            // independently refuses to attach to such an entity.
            [styles.inapplicable]: inapplicable
          })}
          title={intl.formatMessage({
            id: 'actionBar.transformTool',
            defaultMessage:
              'Move tools (m) - Choose how to move and rotate the selected object'
          })}
        >
          <Icon />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="MenubarContent"
          side="top"
          align="center"
          sideOffset={8}
          onEscapeKeyDown={onEscapeKeyDown}
        >
          {MOVE_GIZMO_MODES.map((mode) => {
            const ItemIcon = ICONS[mode];
            return (
              <DropdownMenu.Item
                key={mode}
                className="MenubarItem"
                onSelect={() => changeTransformMode(mode)}
              >
                <ItemIcon />
                <span className={styles.menuLabel}>
                  {intl.formatMessage(LABELS[mode])}
                </span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

export { TransformModeMenu };
