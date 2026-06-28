import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import { getEntityIcon, getEntityDisplayName } from '../../lib/entity';
import useAssetUploadStatus from '../elements/useAssetUploadStatus';

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
 */
const EntityLabel = ({ entity }) => {
  const intl = useIntl();
  const state = useAssetUploadStatus(entity);
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

  return (
    <span className="entityPrint">
      {icon && <span className="entityIcons">{icon}</span>}
      {displayName && <span className="entityName">&nbsp;{displayName}</span>}
    </span>
  );
};

EntityLabel.propTypes = {
  entity: PropTypes.object
};

export default EntityLabel;
