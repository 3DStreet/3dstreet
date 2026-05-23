/**
 * Side-panel "Model Info" block for entities backed by a cloud asset
 * (data-asset-id present). Renders an abbreviated, one-line attribution
 * summary — no link, no full breakdown. The mesh details modal is the
 * place for full editing.
 *
 * MixinMetadata covers the bundled-catalog case; this component covers the
 * user-uploaded case. Both render under the same `details` slot in
 * ComponentsContainer so they look visually consistent.
 */

import PropTypes from 'prop-types';
import useAssetUploadStatus from './useAssetUploadStatus';
import useAssetUploadStore from '@/editor/state/assetUploadStore.js';
import { buildAbbreviatedAttribution } from '@shared/asset-upload/extractGlbAttribution.js';

const AssetMetadata = ({ entity }) => {
  const state = useAssetUploadStatus(entity);
  const cacheKey =
    state?.assetId && state?.ownerUid
      ? `${state.assetId}:${state.ownerUid}`
      : null;
  const cachedAsset = useAssetUploadStore((s) =>
    cacheKey ? s.assets[cacheKey] : null
  );

  if (!state?.assetId) return null;
  const data = cachedAsset?.data;
  if (!data) return null;

  const attribution = data.attribution || null;
  const abbreviated = buildAbbreviatedAttribution(attribution);

  // Show the block even when there's no attribution — having the model
  // identifiable in the side panel is useful in its own right (name, type).
  return (
    <div className="mixin-metadata">
      <div className="collapsible component">
        <div className="static">
          <div className="componentHeader collapsible-header">
            <span className="componentTitle" title="Model">
              <span>Model Info</span>
            </span>
          </div>
        </div>
        {data.name && (
          <div className="propertyRow">
            <div className="text">name</div>
            <div className="string">{data.name}</div>
          </div>
        )}
        {abbreviated && (
          <div className="propertyRow">
            <div className="text">attribution</div>
            <div
              className="string"
              title={attribution?.attribution || abbreviated}
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%'
              }}
            >
              {abbreviated}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

AssetMetadata.propTypes = {
  entity: PropTypes.object.isRequired
};

export default AssetMetadata;
