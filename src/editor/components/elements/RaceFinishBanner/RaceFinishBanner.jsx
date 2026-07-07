import { useState, useEffect } from 'react';
import useStore from '@/store';
import styles from './RaceFinishBanner.module.scss';

const formatTime = (ms) => {
  const totalMs = Math.max(0, ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = (totalMs % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
};

const formatDelta = (ms) => {
  const sign = ms < 0 ? '-' : '+';
  const totalMs = Math.abs(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = (totalMs % 60000) / 1000;
  return `${sign}${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
};

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

  const headline = isFirst ? 'Finished' : isNewBest ? 'New best!' : 'Finished';

  const subline = isFirst
    ? collisions > 0
      ? `${formatTime(simMs)} + ${collisions} collision${collisions === 1 ? '' : 's'}`
      : 'First run on this course'
    : `${formatDelta(deltaMs)} vs best ${formatTime(previousBestMs)}` +
      (collisions > 0
        ? ` · ${collisions} collision${collisions === 1 ? '' : 's'}`
        : '');

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
      <div className={styles.dismissHint}>click to dismiss</div>
    </div>
  );
};
