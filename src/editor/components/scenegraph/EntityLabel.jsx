import PropTypes from 'prop-types';
import { getEntityIcon, getEntityDisplayName } from '../../lib/entity';
import useAssetUploadStatus from '../elements/useAssetUploadStatus';

const ASSET_TYPE_PREFIX = {
  mesh: 'glTF Model',
  image: 'Image',
  video: 'Video',
  splat: 'Splat'
};

/**
 * Renders an entity's icon + display name. For entities backed by a cloud
 * asset (data-asset-id present), the asset `name` is used, prefixed with
 * a human-readable type label (e.g. "glTF Model • truck"). Other entities
 * fall back to the default lookup chain (data-layer-name → class → tag)
 * via getEntityDisplayName.
 */
const EntityLabel = ({ entity }) => {
  const state = useAssetUploadStatus(entity);
  if (!entity) return null;

  const icon = getEntityIcon(entity);
  let override = null;
  if (state?.assetId && state.name) {
    const prefix = ASSET_TYPE_PREFIX[state.type];
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
