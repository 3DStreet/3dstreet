import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl, defineMessages } from 'react-intl';
import { useAssetLoadSummary } from './useAssetLoadTracker';
import { getEntityDisplayName } from '../../lib/entity';

// How long "All assets loaded" stays up once the last pending load settles.
export const DONE_LINGER_MS = 2500;

const MESSAGES = defineMessages({
  failedTitle: {
    id: 'sceneLoad.failedTitle',
    defaultMessage: 'Did not load: {names}'
  }
});

function failureLabel(entry) {
  if (entry.label) return entry.label;
  if (entry.kind === 'texture') {
    return String(entry.key).replace(/^texture:/, '');
  }
  const key = entry.key;
  if (key && typeof key === 'object' && key.tagName) {
    try {
      return getEntityDisplayName(key);
    } catch (_) {
      return key.id || key.tagName.toLowerCase();
    }
  }
  return String(key);
}

/**
 * Non-blocking scene asset progress at the foot of the layers panel (#2009):
 * a count + thin bar while GLBs and textures are in flight, an activity note
 * while splats or tiles stream, a persistent line for loads that failed or
 * timed out, and a brief "all loaded" confirmation. Hidden when idle.
 */
const SceneLoadIndicator = () => {
  const intl = useIntl();
  const summary = useAssetLoadSummary();
  // "All assets loaded" lingers per completed wave, identified by its
  // settled/total counts so unrelated tracker changes (a stream toggling)
  // neither re-show nor cut it short.
  const wave = summary.done ? `${summary.settled}/${summary.total}` : null;
  const [lingerExpiredFor, setLingerExpiredFor] = useState(null);

  useEffect(() => {
    if (!wave) return undefined;
    const timer = setTimeout(() => setLingerExpiredFor(wave), DONE_LINGER_MS);
    return () => clearTimeout(timer);
  }, [wave]);

  const failures = summary.error + summary.timedOut;
  const loading = summary.pending > 0;
  const streaming = summary.streamsActive > 0;
  const showDone = !!wave && lingerExpiredFor !== wave;
  if (!loading && !streaming && !failures && !showDone) return null;

  const failureNames = summary.failures.map(failureLabel).join(', ');

  return (
    <div
      className={
        'scene-load-indicator' +
        (loading ? ' is-loading' : '') +
        (failures ? ' has-failures' : '')
      }
      role="status"
      aria-live="polite"
    >
      <div className="scene-load-indicator-row">
        {loading ? (
          <span className="scene-load-indicator-text">
            <FormattedMessage
              id="sceneLoad.loading"
              defaultMessage="Loading assets {settled} / {total}"
              values={{ settled: summary.settled, total: summary.total }}
            />
          </span>
        ) : showDone && !failures ? (
          <span className="scene-load-indicator-text is-done">
            <FormattedMessage
              id="sceneLoad.done"
              defaultMessage="All assets loaded"
            />
          </span>
        ) : null}
        {failures > 0 && (
          <span
            className="scene-load-indicator-failures"
            title={intl.formatMessage(MESSAGES.failedTitle, {
              names: failureNames
            })}
          >
            <FormattedMessage
              id="sceneLoad.failed"
              defaultMessage="{count, plural, one {# asset} other {# assets}} did not load"
              values={{ count: failures }}
            />
          </span>
        )}
        {streaming && (
          <span className="scene-load-indicator-stream">
            <span className="scene-load-indicator-stream-dot" />
            <FormattedMessage
              id="sceneLoad.streaming"
              defaultMessage="Streaming"
            />
          </span>
        )}
      </div>
      {loading && (
        <div className="scene-load-indicator-track">
          <div
            className="scene-load-indicator-bar"
            style={{ width: `${Math.round(summary.progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default SceneLoadIndicator;
