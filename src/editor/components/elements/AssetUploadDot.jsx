import PropTypes from 'prop-types';
import useAssetUploadStatus, {
  STATUS_LABELS,
  REASON_TEXT
} from './useAssetUploadStatus';

const AssetUploadDot = ({ entity }) => {
  const state = useAssetUploadStatus(entity);
  if (!state) return null;
  const meta = STATUS_LABELS[state.status] || STATUS_LABELS.uploaded;
  const reasonText = state.reason ? REASON_TEXT[state.reason] : null;
  const baseTitle =
    state.status === 'uploading' && state.progress > 0
      ? `Uploading ${state.progress}%`
      : meta.text;
  const title = reasonText ? `${baseTitle} — ${reasonText}` : baseTitle;
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: meta.color,
        marginLeft: 4,
        flexShrink: 0
      }}
    />
  );
};

AssetUploadDot.propTypes = {
  entity: PropTypes.object
};

export default AssetUploadDot;
