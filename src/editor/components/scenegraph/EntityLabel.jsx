import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { getEntityIcon, getEntityDisplayName } from '../../lib/entity';
import useAssetUploadStatus from '../elements/useAssetUploadStatus';
import InlineEditInput from '../elements/InlineEditInput';
import { Edit24Icon } from '@shared/icons';
import { commonMessages } from '@/editor/i18n/commonMessages';

const ASSET_TYPE_PREFIX_MESSAGES = {
  mesh: { id: 'entity.assetTypeMesh', defaultMessage: 'glTF Model' },
  image: { id: 'entity.assetTypeImage', defaultMessage: 'Image' },
  video: { id: 'entity.assetTypeVideo', defaultMessage: 'Video' },
  splat: { id: 'entity.assetTypeSplat', defaultMessage: 'Splat' }
};

/**
 * Renders an entity's icon + display name. For entities backed by a cloud
 * asset (data-asset-id present), the asset `name` is used, prefixed with
 * a human-readable type label (e.g. "glTF Model • truck"). Other entities
 * fall back to the default lookup chain (data-layer-name → class → tag)
 * via getEntityDisplayName.
 *
 * With `editable`, hovering the name reveals a pencil and clicking edits it
 * in place: Enter (or blur) commits the rename through the undoable
 * entityupdate command, Escape reverts. Cloud-asset entities are excluded —
 * their displayed name comes from the Firestore asset, so a data-layer-name
 * rename would not be reflected.
 */
const EntityLabel = ({ entity, editable = false }) => {
  const intl = useIntl();
  const state = useAssetUploadStatus(entity);
  const [editing, setEditing] = useState(false);

  // Leave edit mode when the selection changes mid-edit.
  useEffect(() => {
    setEditing(false);
  }, [entity]);

  if (!entity) return null;

  const icon = getEntityIcon(entity);
  let override = null;
  if (state?.assetId && state.name) {
    const prefixMessage = ASSET_TYPE_PREFIX_MESSAGES[state.type];
    const prefix = prefixMessage
      ? intl.formatMessage(prefixMessage)
      : undefined;
    override = prefix ? `${prefix} • ${state.name}` : state.name;
  }
  const displayName = override || getEntityDisplayName(entity);
  const canEdit = editable && !override;

  const commitRename = (value) => {
    const newName = value.trim();
    if (!newName || newName === displayName) return;
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'data-layer-name',
      property: '',
      value: newName
    });
  };

  if (canEdit && editing) {
    return (
      <span className="entityPrint">
        {icon && <span className="entityIcons">{icon}</span>}
        <InlineEditInput
          className="entityNameInput"
          defaultValue={displayName}
          onCommit={commitRename}
          onClose={() => setEditing(false)}
        />
      </span>
    );
  }

  return (
    <span className={`entityPrint${canEdit ? ' editable' : ''}`}>
      {icon && <span className="entityIcons">{icon}</span>}
      {displayName && (
        <span
          className="entityName"
          onClick={canEdit ? () => setEditing(true) : undefined}
        >
          &nbsp;{displayName}
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          className="entityRenameButton"
          title={intl.formatMessage(commonMessages.rename)}
          aria-label={intl.formatMessage(commonMessages.rename)}
          onClick={() => setEditing(true)}
        >
          <Edit24Icon />
        </button>
      )}
    </span>
  );
};

EntityLabel.propTypes = {
  entity: PropTypes.object,
  editable: PropTypes.bool
};

export default EntityLabel;
