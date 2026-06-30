import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
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
import { Button } from './Button';
import { commonMessages } from '@/editor/i18n/commonMessages';
import { formatNumber } from '@shared/utils/format';

// Pro asset-storage allowance. Kept as a number + locale-aware unit format so
// changing it never requires touching the translation catalogs (the size is
// interpolated into the message, not baked into each translation).
const PRO_STORAGE_GB = 5;
const formatStorage = () =>
  formatNumber(PRO_STORAGE_GB, {
    style: 'unit',
    unit: 'gigabyte',
    unitDisplay: 'short'
  });

const AssetInfoPanel = ({ entity }) => {
  const intl = useIntl();
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
  // Retry only helps when the same File can succeed on a re-run: a generic
  // failure, or over_quota (the user may free up space, or upgrade, then
  // retry). file_too_large would fail identically without an upgrade, so we
  // show only the Upgrade CTA for it — no dead Retry button.
  const canRetry =
    !!slotFile &&
    !!entity &&
    (state.status === 'failed' ||
      (state.status === 'local_error' && state.reason === 'over_quota'));
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
            <FormattedMessage {...commonMessages.cancel} />
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
            <FormattedMessage {...commonMessages.retry} />
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
        <Button
          variant="upgrade"
          onClick={upgradeForStorage}
          style={{
            width: '100%',
            marginTop: 6,
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 11
          }}
        >
          <FormattedMessage
            id="assetInfo.upgradeStorage"
            defaultMessage="Upgrade for {storage} storage"
            values={{ storage: formatStorage() }}
          />
        </Button>
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
            <FormattedMessage
              id="assetInfo.assetSource"
              defaultMessage="Asset source: {ownership} · {assetIdShort}…"
              values={{
                ownership: isOwned
                  ? intl.formatMessage({
                      id: 'assetInfo.ownershipYours',
                      defaultMessage: 'your cloud'
                    })
                  : intl.formatMessage({
                      id: 'assetInfo.ownershipNotOwned',
                      defaultMessage: 'not owned by you'
                    }),
                assetIdShort: state.assetId.slice(0, 8)
              }}
            />
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
            <FormattedMessage id="assetInfo.details" defaultMessage="Details" />
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
