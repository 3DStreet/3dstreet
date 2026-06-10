import { useState } from 'react';
import PropTypes from 'prop-types';
import posthog from 'posthog-js';
import useAssetUploadStatus, {
  STATUS_LABELS,
  REASON_TEXT
} from './useAssetUploadStatus';
import useAssetUploadStore from '@/editor/state/assetUploadStore.js';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import { uploadAndPlaceAsset } from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import { AssetDetailModal, formatBytes } from '@shared/assets';
import { openInGenerator } from '@/editor/lib/asset-modal-handlers.js';
import useStore from '@/store.js';

const AssetInfoPanel = ({ entity }) => {
  const state = useAssetUploadStatus(entity);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!state) return null;

  const meta = STATUS_LABELS[state.status] || STATUS_LABELS.uploaded;
  const sizeStr = state.sizeBytes ? formatBytes(state.sizeBytes) : '';
  const { isOwned } = state;

  // Upload blocked by the plan's storage quota (#1644). The upload slot
  // keeps the original File, so after a Pro upgrade the same Retry button
  // re-runs the upload without the user having to re-drop the file.
  const isQuotaBlocked =
    state.reason === 'over_quota' || state.reason === 'file_too_large';
  const slotFile = useAssetUploadStore.getState().uploads[entity?.id]?.file;
  const canRetry =
    !!slotFile &&
    !!entity &&
    (state.status === 'failed' ||
      (state.status === 'local_error' && isQuotaBlocked));
  const retryUpload = () => uploadAndPlaceAsset(slotFile, null, entity);
  const upgradeForStorage = () => {
    posthog.capture('storage_upsell_clicked', {
      severity: 'upload_blocked',
      reason: state.reason
    });
    useStore.getState().startCheckout('storage');
  };

  let detail = '';
  if (state.status === 'uploading' && state.progress > 0) {
    detail = `${state.progress}%`;
  } else if (
    (state.status === 'uploaded' ||
      state.status === 'local' ||
      state.status === 'local_error') &&
    sizeStr
  ) {
    detail = sizeStr;
  }

  const reasonText = state.reason ? REASON_TEXT[state.reason] : null;

  return (
    <div
      style={{
        padding: '10px 12px',
        margin: '0 0 8px 0',
        background: 'rgba(255,255,255,0.04)',
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: '4px',
        fontSize: '12px',
        lineHeight: 1.4
      }}
      role="status"
      aria-live="polite"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: meta.color,
            display: 'inline-block'
          }}
        />
        <strong style={{ color: meta.color }}>{meta.text}</strong>
        {detail && <span style={{ opacity: 0.7 }}>· {detail}</span>}
        {(state.status === 'uploading' || state.status === 'optimizing') && (
          <button
            type="button"
            onClick={() => useCurrentUploadStore.getState().cancel()}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid currentColor',
              color: 'currentColor',
              borderRadius: 3,
              padding: '2px 6px',
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        )}
        {canRetry && (
          <button
            type="button"
            onClick={retryUpload}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid currentColor',
              color: 'currentColor',
              borderRadius: 3,
              padding: '2px 6px',
              fontSize: 11,
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        )}
      </div>
      {reasonText && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: meta.color,
            opacity: 0.95
          }}
        >
          {reasonText}
        </div>
      )}
      {isQuotaBlocked && (
        <button
          type="button"
          onClick={upgradeForStorage}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 6,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: 'none',
            color: 'white',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Upgrade for 5 GB storage
        </button>
      )}
      {state.assetId && (
        <div
          style={{
            marginTop: 4,
            opacity: 0.6,
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 6
          }}
        >
          <span>
            Asset source: {isOwned ? 'your cloud' : 'not owned by you'} ·{' '}
            {state.assetId.slice(0, 8)}…
          </span>
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: '1px solid currentColor',
              color: 'currentColor',
              borderRadius: 3,
              padding: '2px 6px',
              fontSize: 11,
              cursor: 'pointer',
              opacity: 1
            }}
          >
            Details
          </button>
        </div>
      )}
      {state.originalFilename && (
        <div style={{ marginTop: 2, opacity: 0.5, fontSize: 11 }}>
          {state.originalFilename}
        </div>
      )}
      {detailsOpen && state.assetId && state.ownerUid && (
        // AssetDetailModal owns the type→modal routing (mesh/splat → 3D viewer,
        // image/video → AssetsModal) and fetches the doc itself when needed, so
        // this site no longer re-decides it.
        <AssetDetailModal
          assetId={state.assetId}
          ownerUid={state.ownerUid}
          type={state.type}
          onClose={() => setDetailsOpen(false)}
          onUseForGenerator={(item) => openInGenerator(item, 'modify')}
          onUseForVideo={(item) => openInGenerator(item, 'video')}
        />
      )}
    </div>
  );
};

AssetInfoPanel.propTypes = {
  entity: PropTypes.object
};

export default AssetInfoPanel;
