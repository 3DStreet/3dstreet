/* global STREET */
import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  faPlay,
  faPause,
  faStop,
  faRotateRight,
  faFlagCheckered,
  faTriangleExclamation
} from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { useHasPlayable } from '@/editor/hooks';
import { getUserProfile } from '@shared/utils/username';
import { ProfileButton } from '@shared/auth/components';
import { AppSwitcher } from '@shared/navigation/components';
import { SceneEditTitle } from '../elements/SceneEditTitle';
import { Button } from '../elements/Button';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import primaryStyles from '../elements/PrimaryToolbar/PrimaryToolbar.module.scss';
import styles from './Toolbar.module.scss';
import { formatSimTime } from '@/aframe-components/play/format-sim-time';

function getPlayModeSystem() {
  return document.querySelector('a-scene')?.systems?.['play-mode'];
}

/**
 * The mode-manager's current control mode ('editor' | 'locomotion' |
 * 'drive' | ...), tracked reactively via the mode-changed scene event.
 */
function useControlMode() {
  const [mode, setMode] = useState(null);
  useEffect(() => {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    const update = () =>
      setMode(sceneEl.systems?.['mode-manager']?.getMode() || null);
    update();
    sceneEl.addEventListener('mode-changed', update);
    return () => sceneEl.removeEventListener('mode-changed', update);
  }, []);
  return mode;
}

/**
 * Simulation clock pill, shown while playing. Displays
 * scene-timer.simulationTime (the canonical deterministic clock every
 * play feature reads) and doubles as the pause/resume toggle.
 */
function SimClock() {
  const isPlayPaused = useStore((s) => s.isPlayPaused);
  const playOutcome = useStore((s) => s.playOutcome);
  const playOutcomeTimeMs = useStore((s) => s.playOutcomeTimeMs);
  const [simMs, setSimMs] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    let lastUpdate = 0;
    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      const timer =
        document.querySelector('a-scene')?.components?.['scene-timer'];
      setSimMs(timer ? timer.simulationTime || 0 : 0);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const intl = useIntl();
  // Separate formatMessage calls so formatjs can statically extract
  // each descriptor.
  const pausedTitle = intl.formatMessage({
    id: 'viewer.simClockPaused',
    defaultMessage: 'Paused — click to resume'
  });
  const runningTitle = intl.formatMessage({
    id: 'viewer.simClockRunning',
    defaultMessage: 'Simulation time — click to pause'
  });
  const finishTitle = intl.formatMessage(
    {
      id: 'viewer.simClockFinish',
      defaultMessage: 'Finished in {time} — click to resume'
    },
    { time: formatSimTime(playOutcomeTimeMs) }
  );
  const crashTitle = intl.formatMessage(
    {
      id: 'viewer.simClockCrash',
      defaultMessage: 'Crash at {time}'
    },
    { time: formatSimTime(playOutcomeTimeMs) }
  );

  const isFinish = playOutcome === 'finish';
  const isCrash = playOutcome === 'crash';
  // Outcome states freeze the display value so the user sees the
  // event time, not the still-running sim clock.
  const displayMs = isFinish || isCrash ? playOutcomeTimeMs : simMs;
  const icon = isFinish
    ? faFlagCheckered
    : isCrash
      ? faTriangleExclamation
      : isPlayPaused
        ? faPlay
        : faPause;
  const title = isFinish
    ? finishTitle
    : isCrash
      ? crashTitle
      : isPlayPaused
        ? pausedTitle
        : runningTitle;
  const className = [
    styles.simClock,
    isFinish ? styles.simClockFinish : '',
    isCrash ? styles.simClockCrash : '',
    !isFinish && !isCrash && isPlayPaused ? styles.simClockPaused : ''
  ].join(' ');

  return (
    <button
      type="button"
      className={className}
      onClick={() => getPlayModeSystem()?.togglePause()}
      title={title}
    >
      <AwesomeIcon icon={icon} size={10} />
      <span className={styles.simClockValue}>{formatSimTime(displayMs)}</span>
    </button>
  );
}

/**
 * Viewer top bar — the marquee shown whenever the scene is presented
 * without the editor (inspector closed). One component for every
 * audience; permission only changes the primary action:
 *   - scene author (or unsaved local scene): "Edit Scene"
 *   - anyone else: "Remix" (opens the editor; saving forks a copy)
 * Play/pause controls appear only when the scene has a registered
 * playable capability — static scenes never see them.
 */
function Toolbar() {
  const intl = useIntl();
  const isInspectorEnabled = useStore((s) => s.isInspectorEnabled);
  const setIsInspectorEnabled = useStore((s) => s.setIsInspectorEnabled);
  const isPlaying = useStore((s) => s.isPlaying);
  const isPlayPaused = useStore((s) => s.isPlayPaused);
  const isLocomotionEnabled = useStore((s) => s.isLocomotionEnabled);
  const { currentUser, isLoading: isAuthLoading } = useAuthContext() || {};
  const setModal = useStore((s) => s.setModal);
  const hasPlayable = useHasPlayable();
  const controlMode = useControlMode();
  const [authorId, setAuthorId] = useState(null);
  const [authorUsername, setAuthorUsername] = useState(null);

  // Snapshot the scene's author on viewer entry, and resolve their
  // public username (socialProfile reads require a signed-in user, so
  // signed-out visitors just don't get a byline yet).
  useEffect(() => {
    if (isInspectorEnabled) return undefined;
    const id = STREET.utils.getAuthorId() || null;
    setAuthorId(id);
    setAuthorUsername(null);
    if (!id || !currentUser || currentUser.uid === id) return undefined;
    let cancelled = false;
    getUserProfile(id)
      .then((profile) => {
        if (!cancelled && profile?.username) {
          setAuthorUsername(profile.username);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isInspectorEnabled, currentUser]);

  // Escape backs out one level: stop the running simulation first,
  // then (next press) return to the editor.
  useEffect(() => {
    if (isInspectorEnabled) return undefined;
    const onKeyDown = (e) => {
      if (e.code !== 'Escape') return;
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const playMode = getPlayModeSystem();
      if (playMode?.isPlaying) {
        playMode.stop();
      } else {
        useStore.getState().setIsInspectorEnabled(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isInspectorEnabled]);

  if (isInspectorEnabled) return null;

  const isAuthor = !authorId || (currentUser && currentUser.uid === authorId);
  // A counting millisecond clock only earns its place when time IS the
  // game (drive mode: lap timing, crash penalties). Other simulations
  // (traffic, replay) get a plain pause toggle instead.
  const showSimClock = controlMode === 'drive';

  return (
    <>
      {/* Exactly the editor's hidden-panels header pill (same DOM +
          global classes), minus the Save cloud icon and with a wider
          title allowance. Title stays renameable for the author,
          read-only for everyone else. */}
      <div id="scenegraph" className="scenegraph">
        <div className="scenegraph-panel hide viewer-header">
          <div id="left-panel-header">
            <div className="left-panel-header-row">
              <AppSwitcher />
              <div className="scene-title clickable truncate">
                <SceneEditTitle readOnly={!isAuthor} />
              </div>
              {!isAuthor && authorUsername && (
                <span className="viewer-byline">
                  <FormattedMessage
                    id="viewer.byAuthor"
                    defaultMessage="by {username}"
                    values={{ username: authorUsername }}
                  />
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Shuttle controls, centered like the editor's PrimaryToolbar.
          Only the scene's owner gets them, and only when the scene has
          something playable — visitors and static scenes see none. */}
      {isAuthor && hasPlayable && (
        <div id="viewer-shuttle" className={`clickable ${styles.shuttleDock}`}>
          <div className={primaryStyles.wrapper}>
            {isPlaying ? (
              <>
                {showSimClock ? (
                  <SimClock />
                ) : (
                  <Button
                    variant="toolbtn"
                    onClick={() => getPlayModeSystem()?.togglePause()}
                    leadingIcon={
                      <AwesomeIcon
                        icon={isPlayPaused ? faPlay : faPause}
                        size={14}
                      />
                    }
                  >
                    {isPlayPaused ? (
                      <FormattedMessage
                        id="viewer.resume"
                        defaultMessage="Resume"
                      />
                    ) : (
                      <FormattedMessage
                        id="viewer.pause"
                        defaultMessage="Pause"
                      />
                    )}
                  </Button>
                )}
                <div className={primaryStyles.divider} />
                <Button
                  variant="toolbtn"
                  onClick={() => getPlayModeSystem()?.reset()}
                  leadingIcon={<AwesomeIcon icon={faRotateRight} size={14} />}
                  title={intl.formatMessage({
                    id: 'viewer.resetTitle',
                    defaultMessage:
                      'Reset — restart the simulation from t=0 with objects at spawn'
                  })}
                >
                  <FormattedMessage id="viewer.reset" defaultMessage="Reset" />
                </Button>
                <div className={primaryStyles.divider} />
                <Button
                  variant="toolbtn"
                  onClick={() => getPlayModeSystem()?.stop()}
                  leadingIcon={<AwesomeIcon icon={faStop} size={14} />}
                >
                  <FormattedMessage id="viewer.stop" defaultMessage="Stop" />
                </Button>
              </>
            ) : (
              <Button
                variant="toolbtn"
                onClick={() => getPlayModeSystem()?.start()}
                leadingIcon={<AwesomeIcon icon={faPlay} size={14} />}
              >
                <FormattedMessage id="viewer.play" defaultMessage="Start" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Identity + access, top-right — mirrors the editor's collapsed
          auth dock. The primary action (Edit for the owner, Remix for
          everyone else) works unauthenticated: Remix opens the editor
          and sign-in happens at save time. Same ProfileButton component
          as the editor, including its signed-out state. */}
      <div id="viewer-right-dock" className={`clickable ${styles.rightDock}`}>
        <div className={primaryStyles.wrapper}>
          {/* Access state pairs exactly with the action: "View only"
              appears iff the action is Remix (you can't edit this scene
              in place). When the action is Edit, you can edit — so no
              view-only label. Covers unauthenticated visitors on cloud
              scenes (not theirs → Remix) without mislabeling an
              unauthed user's own local draft (Edit). */}
          {!isAuthor && (
            <>
              <span className={styles.viewOnlyText}>
                <FormattedMessage
                  id="viewer.viewOnly"
                  defaultMessage="View only"
                />
              </span>
              <div className={primaryStyles.divider} />
            </>
          )}
          <Button
            onClick={() => setIsInspectorEnabled(true)}
            variant="toolbtn"
            title={
              isAuthor
                ? undefined
                : intl.formatMessage({
                    id: 'viewer.remixTitle',
                    defaultMessage:
                      'Open the editor — saving will create your own copy'
                  })
            }
          >
            {isAuthor ? (
              <FormattedMessage id="toolbar.edit" defaultMessage="Edit" />
            ) : (
              <FormattedMessage id="viewer.remix" defaultMessage="Remix" />
            )}
          </Button>
        </div>
        <ProfileButton
          currentUser={currentUser}
          isLoading={isAuthLoading}
          onClick={() => {
            if (isAuthLoading) return;
            setModal(currentUser ? 'profile' : 'signin');
          }}
          tooltipSide="bottom"
        />
      </div>
      {isLocomotionEnabled && (
        <div className={styles.controlsHint}>
          <span className={styles.keyGroup}>W A S D</span>{' '}
          <FormattedMessage id="viewer.hintMove" defaultMessage="to move" />
          {' · '}
          <span className={styles.keyGroup}>
            <FormattedMessage
              id="viewer.hintClickDrag"
              defaultMessage="Click + Drag"
            />
          </span>{' '}
          <FormattedMessage id="viewer.hintLook" defaultMessage="to look" />
        </div>
      )}
    </>
  );
}

export default Toolbar;
