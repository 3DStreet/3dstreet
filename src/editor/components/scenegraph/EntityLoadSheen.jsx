import PropTypes from 'prop-types';
import { defineMessages, useIntl } from 'react-intl';
import { LOAD_STATUS } from '@/asset-load-tracker';
import { useEntityLoadState } from './useAssetLoadTracker';

const MESSAGES = defineMessages({
  pending: {
    id: 'entity.load.pending',
    defaultMessage: 'Loading 3D model…'
  },
  error: {
    id: 'entity.load.error',
    defaultMessage: "Didn't load. The file may be missing or invalid."
  },
  timedOut: {
    id: 'entity.load.timedOut',
    defaultMessage: 'Still loading. Slow connection or large file.'
  }
});

/**
 * Ambient load state for a layer row (#2009): a faint sheen animates behind
 * the row's content while its 3D model downloads, fades out once it lands,
 * and settles to a faint warning wash if the load failed. It never adds an
 * icon or text to the row; hovering the row explains the state in a tooltip.
 * Streaming layers (splats, tiles) get nothing here by design.
 *
 * Rendered as the row's first child and painted behind the content via
 * z-index (the row isolates its stacking context in scenegraph.scss).
 */
const EntityLoadSheen = ({ entity }) => {
  const intl = useIntl();
  const state = useEntityLoadState(entity);
  if (!state || state.streaming) return null;

  let modifier;
  let message;
  switch (state.status) {
    case LOAD_STATUS.PENDING:
      modifier = 'is-pending';
      message = MESSAGES.pending;
      break;
    case LOAD_STATUS.TIMED_OUT:
      modifier = 'is-pending is-slow';
      message = MESSAGES.timedOut;
      break;
    case LOAD_STATUS.ERROR:
      modifier = 'is-error';
      message = MESSAGES.error;
      break;
    default:
      // Loaded: keep the element so the sheen can fade out via CSS.
      modifier = 'is-loaded';
      message = null;
  }
  const title = message ? intl.formatMessage(message) : undefined;
  return (
    <span
      className={`entityLoadSheen ${modifier}`}
      title={title}
      aria-label={title}
      role={title ? 'status' : undefined}
    />
  );
};

EntityLoadSheen.propTypes = {
  entity: PropTypes.object
};

export default EntityLoadSheen;
