import { useEffect, useRef } from 'react';
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
 * z-index (the row isolates its stacking context in scenegraph.scss). Being
 * behind the content, the span itself is never hovered, so the tooltip is
 * set on the row element instead.
 */
const EntityLoadSheen = ({ entity }) => {
  const intl = useIntl();
  const state = useEntityLoadState(entity);
  const ref = useRef(null);
  const shown = !!state && !state.streaming;
  let modifier;
  let message;
  if (shown) {
    ({ modifier, message } = classify(state.status));
  }
  const title = message ? intl.formatMessage(message) : null;

  useEffect(() => {
    const row = ref.current && ref.current.parentElement;
    if (!row || !title) return undefined;
    row.setAttribute('title', title);
    return () => {
      if (row.getAttribute('title') === title) row.removeAttribute('title');
    };
  }, [title]);

  if (!shown) return null;
  return (
    <span
      ref={ref}
      className={`entityLoadSheen ${modifier}`}
      aria-label={title || undefined}
      role={title ? 'status' : undefined}
    />
  );
};

function classify(status) {
  let modifier;
  let message;
  switch (status) {
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
  return { modifier, message };
}

EntityLoadSheen.propTypes = {
  entity: PropTypes.object
};

export default EntityLoadSheen;
