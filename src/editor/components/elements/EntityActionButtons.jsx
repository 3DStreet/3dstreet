import { forwardRef } from 'react';
import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import { Tooltip } from 'radix-ui';
import Events from '../../lib/Events';
import {
  cloneEntity,
  removeSelectedEntity,
  setFocusCameraPose
} from '../../lib/entity';
import { editShortcuts } from '../../lib/editShortcuts';
import { commonMessages } from '@/editor/i18n/commonMessages';
import { ArrowsPointingInwardIcon, Copy32Icon, TrashIcon } from '@shared/icons';
import { Button } from './Button';
import { ToolTip } from './PrimaryToolbar/PrimaryToolbar';
import toolbarStyles from './PrimaryToolbar/PrimaryToolbar.module.scss';

// 28px icon action button used in the entity panel headers (formerly local
// to StreetSegmentSidebar). forwardRef so a radix Tooltip.Trigger (asChild)
// can anchor to the real button element.
export const IconButton = forwardRef(function IconButton(
  { title, disabled, onClick, onLongPress, children, ...rest },
  ref
) {
  return (
    <Button
      ref={ref}
      variant="custom"
      className="segment-action-btn"
      title={title}
      disabled={disabled}
      onClick={onClick}
      onLongPress={onLongPress}
      longPressDelay={onLongPress ? 1500 : undefined}
      {...rest}
    >
      {children}
    </Button>
  );
});

IconButton.propTypes = {
  title: PropTypes.string,
  disabled: PropTypes.bool,
  onClick: PropTypes.func,
  onLongPress: PropTypes.func,
  children: PropTypes.node
};

// Immediate tooltip (same treatment as the primary toolbar's "Hide panels"):
// label plus a keyboard-hint chip from editShortcuts.
export const ActionTooltip = ({ label, kbd, children }) => (
  <ToolTip
    content={
      <>
        {label}
        {kbd && <span className={toolbarStyles.tooltipKbd}>{kbd}</span>}
      </>
    }
  >
    {children}
  </ToolTip>
);

ActionTooltip.propTypes = {
  label: PropTypes.string.isRequired,
  kbd: PropTypes.string,
  children: PropTypes.node
};

/**
 * Focus / Duplicate / Delete icon-button group shared by every entity
 * sidepanel header — the managed-street panel's inline treatment,
 * generalized. Long-pressing Focus stores the entity's focus camera pose.
 * `onDuplicate` / `onDelete` override the default actions so panels can
 * add analytics (the segment panel) while keeping one look.
 */
const EntityActionButtons = ({ entity, onDuplicate, onDelete }) => {
  const intl = useIntl();
  return (
    <Tooltip.Provider>
      <div className="segment-actions entity-action-buttons">
        <ActionTooltip
          label={intl.formatMessage(commonMessages.focus)}
          kbd={editShortcuts.focus}
        >
          <IconButton
            onClick={() => Events.emit('objectfocus', entity.object3D)}
            onLongPress={() => setFocusCameraPose(entity)}
          >
            <ArrowsPointingInwardIcon />
          </IconButton>
        </ActionTooltip>
        <ActionTooltip
          label={intl.formatMessage(commonMessages.duplicate)}
          kbd={editShortcuts.duplicate}
        >
          <IconButton
            onClick={() => (onDuplicate ? onDuplicate() : cloneEntity(entity))}
          >
            <Copy32Icon />
          </IconButton>
        </ActionTooltip>
        <ActionTooltip
          label={intl.formatMessage(commonMessages.delete)}
          kbd={editShortcuts.delete}
        >
          <IconButton
            onClick={() => (onDelete ? onDelete() : removeSelectedEntity())}
          >
            <TrashIcon />
          </IconButton>
        </ActionTooltip>
      </div>
    </Tooltip.Provider>
  );
};

EntityActionButtons.propTypes = {
  entity: PropTypes.object.isRequired,
  onDuplicate: PropTypes.func,
  onDelete: PropTypes.func
};

export default EntityActionButtons;
