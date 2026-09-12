import PropTypes from 'prop-types';
import useAssetUploadStatus, {
  STATUS_LABELS,
  REASON_TEXT,
  getStatusText
} from './useAssetUploadStatus';
import { useSharedMessages } from '@shared/i18n/sharedMessages.js';

// Only states that need attention get a dot: in-flight (amber) and
// failed/missing (red). A synced cloud asset or a plain local preview is the
// normal case and shows nothing, so the scene graph stays quiet.
const QUIET_STATUSES = new Set(['uploaded', 'local']);

/**
 * Corner badge on the entity's scene-graph icon. Rendered inside
 * `.entityIcons` (position: relative) and pinned to its upper right.
 */
const AssetUploadDot = ({ entity }) => {
  const t = useSharedMessages();
  const state = useAssetUploadStatus(entity);
  if (!state || QUIET_STATUSES.has(state.status)) return null;
  const meta = STATUS_LABELS[state.status] || STATUS_LABELS.uploaded;
  const reasonText = state.reason ? REASON_TEXT[state.reason] : null;
  const baseTitle = getStatusText(t, state);
  const title = reasonText ? `${baseTitle} — ${reasonText}` : baseTitle;
  return (
    <span
      className="assetStatusDot"
      title={title}
      aria-label={title}
      style={{ background: meta.color }}
    />
  );
};

AssetUploadDot.propTypes = {
  entity: PropTypes.object
};

export default AssetUploadDot;
