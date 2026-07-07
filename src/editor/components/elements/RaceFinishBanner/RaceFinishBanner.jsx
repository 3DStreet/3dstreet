import { useState, useEffect } from 'react';
import { useIntl } from 'react-intl';
import useStore from '@/store';
import styles from './RaceFinishBanner.module.scss';
import {
  formatSimTime as formatTime,
  formatSimDelta as formatDelta
} from '@/aframe-components/play/format-sim-time';

/**
 * Trackmania-style banner shown on race-finish. Reads `playFinish` from
 * the store (populated by play-mode.onRaceFinish). Three visual states:
 *   - Green (new best, with previous-best baseline)
 *   - Red   (slower than best)
 *   - Blue  (first run for this course — no comparison yet)
 *
 * Click anywhere on the banner to dismiss. No auto-dismiss: race-finish
 * also pauses play, so the banner stays until the player acts (resume,
 * reset, or stop all clear `playFinish`).
 */
export const RaceFinishBanner = () => {
  const intl = useIntl();
  const playFinish = useStore((s) => s.playFinish);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissal when a new finish lands (finishedAt changes).
  useEffect(() => {
    setDismissed(false);
  }, [playFinish?.finishedAt]);

  if (!playFinish || dismissed) return null;

  const { finalMs, simMs, collisions, previousBestMs, isNewBest, deltaMs } =
    playFinish;
  const isFirst = previousBestMs === null;

  const bannerClass = [
    styles.banner,
    isFirst
      ? styles.bannerFirst
      : isNewBest
        ? styles.bannerNewBest
        : styles.bannerSlower
  ].join(' ');

  const headline = isNewBest
    ? intl.formatMessage({
        id: 'raceFinish.newBest',
        defaultMessage: 'New best!'
      })
    : intl.formatMessage({
        id: 'raceFinish.finished',
        defaultMessage: 'Finished'
      });

  let subline;
  if (isFirst) {
    subline =
      collisions > 0
        ? intl.formatMessage(
            {
              id: 'raceFinish.withCollisions',
              defaultMessage:
                '{time} + {collisions, plural, one {# collision} other {# collisions}}'
            },
            { time: formatTime(simMs), collisions }
          )
        : intl.formatMessage({
            id: 'raceFinish.firstRun',
            defaultMessage: 'First run on this course'
          });
  } else {
    const vsBest = intl.formatMessage(
      {
        id: 'raceFinish.vsBest',
        defaultMessage: '{delta} vs best {best}'
      },
      { delta: formatDelta(deltaMs), best: formatTime(previousBestMs) }
    );
    subline =
      collisions > 0
        ? `${vsBest} · ${intl.formatMessage(
            {
              id: 'raceFinish.collisionsSuffix',
              defaultMessage:
                '{collisions, plural, one {# collision} other {# collisions}}'
            },
            { collisions }
          )}`
        : vsBest;
  }

  return (
    <div
      className={bannerClass}
      onClick={() => setDismissed(true)}
      role="button"
      tabIndex={0}
    >
      <div className={styles.headline}>{headline}</div>
      <div className={styles.finalTime}>{formatTime(finalMs)}</div>
      <div className={styles.subline}>{subline}</div>
      <div className={styles.dismissHint}>
        {intl.formatMessage({
          id: 'raceFinish.dismissHint',
          defaultMessage: 'click to dismiss'
        })}
      </div>
    </div>
  );
};
