import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { getEntityIcon, getEntityDisplayName } from '../../lib/entity';
import useAssetUploadStatus from '../elements/useAssetUploadStatus';
import AssetUploadDot from '../elements/AssetUploadDot';
import InlineEditInput from '../elements/InlineEditInput';
import { Edit24Icon } from '@shared/icons';
import { commonMessages } from '@/editor/i18n/commonMessages';

// No 'mesh' entry: 3D-model rows carry a distinct icon (#1999), so the
// "glTF Model" type prefix would be redundant.
const ASSET_TYPE_PREFIX_MESSAGES = {
  image: { id: 'entity.assetTypeImage', defaultMessage: 'Image' },
  video: { id: 'entity.assetTypeVideo', defaultMessage: 'Video' },
  splat: { id: 'entity.assetTypeSplat', defaultMessage: 'Splat' }
};

/**
 * Renders an entity's icon + display name. A user-set data-layer-name
 * always wins — it names this one placement (#2000). Without one, entities
 * backed by a cloud asset (data-asset-id present) show the asset `name`,
 * prefixed with a human-readable type label for non-mesh types (e.g.
 * "Image • logo"). Other entities fall back to the default lookup chain
 * (class → tag) via getEntityDisplayName.
 *
 * With `editable`, hovering the name reveals a pencil and clicking edits it
 * in place: Enter (or blur) commits the rename through the undoable
 * entityupdate command, Escape reverts. On an asset-backed entity the
 * rename writes a per-instance data-layer-name; the shared Firestore asset
 * keeps its own name.
 *
 * `forceEditing` puts the label into edit mode from the outside (the scene
 * graph's context menu Rename item) without the hover pencil affordance;
 * `onEditingEnd` fires when that edit closes so the owner can clear its state.
 * `trailing` renders right after the name text (the scene graph's role
 * badges), inside the label so it never collides with the row's
 * absolutely positioned expand arrow.
 */
const EntityLabel = ({
  entity,
  editable = false,
  forceEditing = false,
  onEditingEnd,
  trailing = null
}) => {
  const intl = useIntl();
  const state = useAssetUploadStatus(entity);
  const [editing, setEditing] = useState(false);

  // Leave edit mode when the selection changes mid-edit; enter it when an
  // external rename request comes in.
  useEffect(() => {
    setEditing(forceEditing);
  }, [entity, forceEditing]);

  if (!entity) return null;

  const icon = getEntityIcon(entity);
  const layerName = entity.getAttribute('data-layer-name');
  let override = null;
  if (!layerName && state?.assetId && state.name) {
    const prefixMessage = ASSET_TYPE_PREFIX_MESSAGES[state.type];
    const prefix = prefixMessage
      ? intl.formatMessage(prefixMessage)
      : undefined;
    override = prefix ? `${prefix} • ${state.name}` : state.name;
  }
  const displayName = layerName || override || getEntityDisplayName(entity);
  // What the rename input opens with: the bare instance/asset name, never
  // the type-prefixed label — committing it unchanged writes nothing.
  const editSeed =
    layerName || (state?.assetId && state.name) || getEntityDisplayName(entity);
  const canEdit = editable || forceEditing;

  const commitRename = (value) => {
    const newName = value.trim();
    if (!newName || newName === editSeed) return;
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'data-layer-name',
      property: '',
      value: newName
    });
  };

  // Upload status rides on the icon as a corner badge (amber/red only; a
  // synced asset shows nothing) so it never collides with the name or
  // the trailing role badges.
  const iconWithStatus = icon && (
    <span className="entityIcons">
      {icon}
      <AssetUploadDot entity={entity} />
    </span>
  );

  if (canEdit && editing) {
    return (
      <span className="entityPrint">
        {iconWithStatus}
        <InlineEditInput
          className="entityNameInput"
          defaultValue={editSeed}
          onCommit={commitRename}
          onClose={() => {
            setEditing(false);
            onEditingEnd?.();
          }}
          // In the scene graph the label sits inside a clickable row —
          // keep clicks in the field from re-selecting / camera-focusing.
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      </span>
    );
  }

  return (
    <span className={`entityPrint${canEdit ? ' editable' : ''}`}>
      {iconWithStatus}
      {displayName && (
        <span
          className="entityName"
          onClick={canEdit ? () => setEditing(true) : undefined}
        >
          &nbsp;{displayName}
        </span>
      )}
      {trailing}
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
  editable: PropTypes.bool,
  forceEditing: PropTypes.bool,
  onEditingEnd: PropTypes.func,
  trailing: PropTypes.node
};

export default EntityLabel;
