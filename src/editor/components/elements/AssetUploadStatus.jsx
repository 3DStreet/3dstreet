import { useState } from 'react';
import PropTypes from 'prop-types';
import useAssetUploadStatus, { STATUS_LABELS } from './useAssetUploadStatus';
import useAssetUploadStore from '@/editor/state/assetUploadStore.js';
import { uploadAndPlaceAsset } from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import { MeshDetailsModal, formatBytes } from '@shared/gallery';

const AssetUploadStatus = ({ entity }) => {
  const state = useAssetUploadStatus(entity);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (!state) return null;

  const meta = STATUS_LABELS[state.status] || STATUS_LABELS.uploaded;
  const sizeStr = state.sizeBytes ? formatBytes(state.sizeBytes) : '';
  const { isOwned } = state;

  let detail = '';
  if (state.status === 'uploading' && state.progress > 0) {
    detail = `${state.progress}%`;
  } else if (state.status === 'uploaded' && sizeStr) {
    detail = sizeStr;
  } else if (state.status === 'local' && sizeStr) {
    detail = sizeStr;
  }

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
        <strong>{meta.text}</strong>
        {detail && <span style={{ opacity: 0.7 }}>· {detail}</span>}
        {state.status === 'failed' && (
          <button
            type="button"
            onClick={() => {
              const slot = useAssetUploadStore.getState().uploads[entity?.id];
              if (!slot?.file || !entity) return;
              uploadAndPlaceAsset(slot.file, null, entity);
            }}
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
        <MeshDetailsModal
          assetId={state.assetId}
          ownerUid={state.ownerUid}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </div>
  );
};

AssetUploadStatus.propTypes = {
  entity: PropTypes.object
};

export default AssetUploadStatus;
