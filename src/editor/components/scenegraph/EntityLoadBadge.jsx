import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { defineMessages, useIntl } from 'react-intl';
import {
  faCircleNotch,
  faCheck,
  faTriangleExclamation
} from '@fortawesome/free-solid-svg-icons';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { LOAD_STATUS } from '@/asset-load-tracker';
import { useEntityLoadState } from './useAssetLoadTracker';

// How long the check mark lingers after a load settles before the row goes
// quiet again.
export const LOADED_CHECK_MS = 2000;

const MESSAGES = defineMessages({
  pending: {
    id: 'entity.load.pending',
    defaultMessage: 'Loading 3D model…'
  },
  loaded: { id: 'entity.load.loaded', defaultMessage: 'Loaded' },
  error: {
    id: 'entity.load.error',
    defaultMessage: 'Failed to load. The file may be missing or invalid.'
  },
  timedOut: {
    id: 'entity.load.timedOut',
    defaultMessage: 'Still loading after 30 s. Slow connection or large file.'
  },
  streamingActive: {
    id: 'entity.load.streamingActive',
    defaultMessage: 'Streaming…'
  },
  streamingIdle: {
    id: 'entity.load.streamingIdle',
    defaultMessage: 'Streaming layer, idle'
  }
});

/**
 * Per-row load state in the scene graph's badge bar (#2009). Deterministic
 * loads (GLBs) show a spinner that becomes a check for a moment, or a warning
 * that stays on error / timeout. Streaming layers (splats, tiles) show an
 * activity light while they fetch and nothing while idle.
 */
const EntityLoadBadge = ({ entity }) => {
  const intl = useIntl();
  const state = useEntityLoadState(entity);
  // The entry whose check mark has already lingered its full window. Entries
  // are replaced on every change, so identity tells "this load" from a later
  // reload of the same entity without reading the clock during render.
  const [checkExpiredFor, setCheckExpiredFor] = useState(null);

  useEffect(() => {
    if (!state || state.status !== LOAD_STATUS.LOADED) return undefined;
    const timer = setTimeout(() => setCheckExpiredFor(state), LOADED_CHECK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (!state) return null;

  if (state.streaming) {
    if (!state.active) return null;
    const title = intl.formatMessage(MESSAGES.streamingActive);
    return (
      <span
        className="entityLoadBadge is-streaming"
        title={title}
        aria-label={title}
        role="status"
      />
    );
  }

  let icon;
  let modifier;
  let message;
  switch (state.status) {
    case LOAD_STATUS.PENDING:
      icon = faCircleNotch;
      modifier = 'is-pending';
      message = MESSAGES.pending;
      break;
    case LOAD_STATUS.LOADED:
      if (checkExpiredFor === state) return null;
      icon = faCheck;
      modifier = 'is-loaded';
      message = MESSAGES.loaded;
      break;
    case LOAD_STATUS.ERROR:
      icon = faTriangleExclamation;
      modifier = 'is-error';
      message = MESSAGES.error;
      break;
    case LOAD_STATUS.TIMED_OUT:
      icon = faTriangleExclamation;
      modifier = 'is-timed-out';
      message = MESSAGES.timedOut;
      break;
    default:
      return null;
  }
  const title = intl.formatMessage(message);
  return (
    <span
      className={`entityLoadBadge ${modifier}`}
      title={title}
      aria-label={title}
      role="status"
    >
      <AwesomeIcon icon={icon} size={12} />
    </span>
  );
};

EntityLoadBadge.propTypes = {
  entity: PropTypes.object
};

export default EntityLoadBadge;
