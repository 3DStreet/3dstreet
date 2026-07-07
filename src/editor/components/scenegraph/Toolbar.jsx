/* global STREET */
import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  faPlay,
  faPause,
  faStop,
  faRotateRight
} from '@fortawesome/free-solid-svg-icons';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { useHasPlayable } from '@/editor/hooks';
import { getUserProfile } from '@shared/utils/username';
import { ProfileButton } from '@shared/auth/components';
import { Button } from '../elements/Button';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import styles from './Toolbar.module.scss';

function getPlayModeSystem() {
  return document.querySelector('a-scene')?.systems?.['play-mode'];
}

function formatSimTime(ms) {
  const totalMs = Math.max(0, ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = (totalMs % 60000) / 1000;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

/**
 * Simulation clock pill, shown while playing. Displays
 * scene-timer.simulationTime (the canonical deterministic clock every
 * play feature reads) and doubles as the pause/resume toggle.
 */
function SimClock() {
  const isPlayPaused = useStore((s) => s.isPlayPaused);
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
  // Two separate formatMessage calls so formatjs can statically
  // extract both descriptors.
  const pausedTitle = intl.formatMessage({
    id: 'viewer.simClockPaused',
    defaultMessage: 'Paused — click to resume'
  });
  const runningTitle = intl.formatMessage({
    id: 'viewer.simClockRunning',
    defaultMessage: 'Simulation time — click to pause'
  });
  return (
    <button
      type="button"
      className={`${styles.simClock} ${isPlayPaused ? styles.simClockPaused : ''}`}
      onClick={() => getPlayModeSystem()?.togglePause()}
      title={isPlayPaused ? pausedTitle : runningTitle}
    >
      <AwesomeIcon icon={isPlayPaused ? faPlay : faPause} size={10} />
      <span className={styles.simClockValue}>{formatSimTime(simMs)}</span>
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
  const sceneTitle = useStore((s) => s.sceneTitle);
  const isPlaying = useStore((s) => s.isPlaying);
  const isLocomotionEnabled = useStore((s) => s.isLocomotionEnabled);
  const { currentUser, isLoading: isAuthLoading } = useAuthContext() || {};
  const setModal = useStore((s) => s.setModal);
  const hasPlayable = useHasPlayable();
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

  return (
    <>
      <div id="toolbar" data-inspector="false" className={styles.toolbarRoot}>
        <div className={styles.toolbarRow}>
          <div className={styles.leftCluster}>
            <img
              src="/ui_assets/3D-St-stacked-128.png"
              alt={intl.formatMessage({
                id: 'toolbar.logoAlt',
                defaultMessage: '3DStreet Logo'
              })}
              className={styles.logo}
            />
            <div className={styles.sceneMeta}>
              <div className={styles.sceneTitle}>
                {sceneTitle || (
                  <FormattedMessage
                    id="viewer.untitledScene"
                    defaultMessage="Untitled Scene"
                  />
                )}
              </div>
              {!isAuthor && (
                <div className={styles.byline}>
                  {authorUsername && (
                    <span className={styles.author}>
                      <FormattedMessage
                        id="viewer.byAuthor"
                        defaultMessage="by {username}"
                        values={{ username: authorUsername }}
                      />
                    </span>
                  )}
                  <span className={styles.viewOnlyChip}>
                    <FormattedMessage
                      id="viewer.viewOnly"
                      defaultMessage="View only"
                    />
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className={styles.rightCluster}>
            {hasPlayable &&
              (isPlaying ? (
                <>
                  <SimClock />
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
                    <FormattedMessage
                      id="viewer.reset"
                      defaultMessage="Reset"
                    />
                  </Button>
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
                  <FormattedMessage id="viewer.play" defaultMessage="Play" />
                </Button>
              ))}
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
            {/* Auth status: what a visitor may access (byline lookup,
                remix-save, future private scenes) depends on who they
                are, so surface it in view mode too. */}
            {currentUser || isAuthLoading ? (
              <ProfileButton
                currentUser={currentUser}
                isLoading={isAuthLoading}
                className={styles.profileButton}
                onClick={() => {
                  if (isAuthLoading) return;
                  setModal(currentUser ? 'profile' : 'signin');
                }}
                tooltipSide="bottom"
              />
            ) : (
              <Button variant="toolbtn" onClick={() => setModal('signin')}>
                <FormattedMessage id="viewer.signIn" defaultMessage="Sign In" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {/* Sibling of #toolbar, not a child: the bar's backdrop-filter makes
          it the containing block for position:fixed descendants, which
          would pin the hint to the bar instead of the viewport. */}
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
