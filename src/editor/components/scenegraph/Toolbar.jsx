/* global STREET */
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ViewerSnapshot } from '../elements/ViewerSnapshot/ViewerSnapshot';
import primaryStyles from '../elements/PrimaryToolbar/PrimaryToolbar.module.scss';
import styles from './Toolbar.module.scss';
import { formatSimTime } from '@/aframe-components/play/format-sim-time';

function getPlayModeSystem() {
  return document.querySelector('a-scene')?.systems?.['play-mode'];
}

/**
 * The mode-manager's current control mode ('editor' | 'viewer' |
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
      defaultMessage: 'Finished in {time} — press Reset to race again'
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
 * audience; the primary action is always "Edit":
 *   - scene author (or unsaved local scene): opens the editor in place
 *   - signed-in non-author: opens the editor on a copy (warning toast;
 *     saving forks via the existing save-as-fork flow)
 *   - signed-out visitor on a cloud scene: "Sign in to Edit"
 * Play/pause controls appear only when the scene has a registered
 * playable capability — static scenes never see them.
 */
function Toolbar() {
  const intl = useIntl();
  const isInspectorEnabled = useStore((s) => s.isInspectorEnabled);
  const setIsInspectorEnabled = useStore((s) => s.setIsInspectorEnabled);
  const isPlaying = useStore((s) => s.isPlaying);
  const isPlayPaused = useStore((s) => s.isPlayPaused);
  const { currentUser, isLoading: isAuthLoading } = useAuthContext() || {};
  const setModal = useStore((s) => s.setModal);
  const hasPlayable = useHasPlayable();
  const controlMode = useControlMode();
  const [authorId, setAuthorId] = useState(null);
  const [authorUsername, setAuthorUsername] = useState(null);

  // Resolve the scene creator's username for the "by {creator}" byline.
  // authorId lives on the scene's `metadata` component, stamped a tick after
  // the `newScene` event fires — so key off that event, not just auth/mode
  // state. Otherwise a viewer that mounted before the scene finished loading
  // reads no author and the byline never appears (the original bug). Shown to
  // the owner too, so an owner viewing their own scene still gets the byline.
  // socialProfile reads require auth (firestore.rules), so signed-out visitors
  // get no byline yet.
  useEffect(() => {
    const sceneEl = AFRAME.scenes[0] || document.querySelector('a-scene');
    if (!sceneEl) return undefined;
    let cancelled = false;
    const resolveByline = () => {
      // metadata is stamped synchronously right after createElementsFromJSON
      // returns (just after newScene) — defer one tick so authorId is readable.
      setTimeout(() => {
        if (cancelled) return;
        const id = STREET.utils.getAuthorId() || null;
        setAuthorId(id);
        setAuthorUsername(null);
        if (!id || !currentUser) return;
        getUserProfile(id)
          .then((profile) => {
            if (!cancelled && profile?.username) {
              setAuthorUsername(profile.username);
            }
          })
          .catch(() => {});
      }, 0);
    };
    resolveByline(); // catch a scene already loaded before this effect ran
    sceneEl.addEventListener('newScene', resolveByline);
    return () => {
      cancelled = true;
      sceneEl.removeEventListener('newScene', resolveByline);
    };
  }, [currentUser]);

  const isAuthor = !authorId || (currentUser && currentUser.uid === authorId);
  // While Firebase is still restoring the session on a cloud scene we
  // can't tell a signed-out visitor from the scene's own author — hold
  // the Edit action (plain label, disabled) instead of bouncing an
  // already-signed-in user into the sign-in modal. Resolves within ~1s;
  // the label corrects itself the moment auth settles.
  const authPending = isAuthLoading && !!authorId && !currentUser;
  // Editing requires an account (#1824 Remix flow): a signed-out
  // visitor on a cloud scene gets a "Sign in to Edit" action instead of
  // the editor. Local drafts (no authorId) keep Edit with no auth —
  // the visitor is effectively the author of their own unsaved work.
  const needsAuthToEdit = !authPending && !isAuthor && !currentUser;

  // The action is always "Edit"; permission shows up as consequence,
  // not vocabulary. A signed-in non-author entering the editor gets a
  // warning toast that they're on a copy — saving forks it to their
  // account (the existing save-as-fork flow). Shared by the Edit
  // button and the viewer's Escape key so the gate can't diverge.
  const handleEnterEditor = useCallback(() => {
    if (authPending) return;
    if (needsAuthToEdit) {
      setModal('signin');
      return;
    }
    setIsInspectorEnabled(true);
    if (!isAuthor) {
      STREET.notify.warningMessage(
        intl.formatMessage({
          id: 'viewer.editingCopyWarning',
          defaultMessage:
            'This is an unsaved copy. Click Save to make your own copy.'
        })
      );
    }
  }, [
    authPending,
    needsAuthToEdit,
    isAuthor,
    setModal,
    setIsInspectorEnabled,
    intl
  ]);

  // Escape backs out one level. Stopping is entry-aware (#1824 Q1):
  // Play entered from the editor pops straight back to the editor (the
  // simulation and the mode were entered as one step, so they exit as
  // one); a visitor's session pops to View-idle, and the next press
  // opens the editor (auth-gated, mirroring the Edit button).
  useEffect(() => {
    if (isInspectorEnabled) return undefined;
    const onKeyDown = (e) => {
      if (e.code !== 'Escape') return;
      if (e.defaultPrevented) return;
      // A modal owns Escape while it is open (it closes itself on keyup,
      // which fires after this keydown — acting here too would close the
      // modal AND kick the user out of the viewer in one press).
      if (useStore.getState().modal) return;
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      const playMode = getPlayModeSystem();
      if (playMode?.isPlaying) {
        useStore.getState().stopPlaying();
      } else {
        handleEnterEditor();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isInspectorEnabled, handleEnterEditor]);

  if (isInspectorEnabled) return null;
  // A counting millisecond clock only earns its place when time IS the
  // game (drive mode: lap timing, crash penalties). Other simulations
  // (traffic, replay) get a plain pause toggle instead.
  const showSimClock = controlMode === 'drive';

  return (
    <>
      {/* Exactly the editor's hidden-panels header pill (same DOM +
          global classes), minus the Save cloud icon and with a wider
          title allowance. The title is always read-only in the viewer —
          renaming is an editor-only action, even for the owner. */}
      <div id="scenegraph" className="scenegraph">
        <div className="scenegraph-panel hide viewer-header">
          <div id="left-panel-header">
            <div className="left-panel-header-row">
              <AppSwitcher />
              <div className="scene-title clickable truncate">
                <SceneEditTitle readOnly />
              </div>
              {authorUsername && (
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
          Shown to anyone viewing a scene with something playable — owner
          or visitor — because playing mutates nothing persistent (the
          design doc: "Playing requires no permission"). This also matches
          the `P` shortcut, which already gates on hasPlayable() alone.
          Drive still requires an explicit action, so a visitor is never
          dropped into a vehicle they didn't ask for. Static scenes
          (hasPlayable === false) show nothing. */}
      {hasPlayable && (
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
                {/* Reset meaning depends on transport state: while
                    playing it's a quick restart (t=0, still running —
                    matches R / gamepad Y mid-drive); while paused it
                    winds all the way back to the viewer's initial
                    state — idle at frame zero, showing Start. Raw
                    stop(), not stopPlaying(): Reset never changes
                    mode, so it stays in the viewer even for an
                    editor-origin session. */}
                <Button
                  variant="toolbtn"
                  onClick={() => {
                    const playMode = getPlayModeSystem();
                    if (!playMode) return;
                    if (playMode.isPaused) playMode.stop();
                    else playMode.reset();
                  }}
                  leadingIcon={<AwesomeIcon icon={faRotateRight} size={14} />}
                  title={
                    isPlayPaused
                      ? intl.formatMessage({
                          id: 'viewer.resetPausedTitle',
                          defaultMessage:
                            'Reset — return to the start frame; press Start to play again'
                        })
                      : intl.formatMessage({
                          id: 'viewer.resetTitle',
                          defaultMessage:
                            'Reset — restart the simulation from t=0 with objects at spawn'
                        })
                  }
                >
                  <FormattedMessage id="viewer.reset" defaultMessage="Reset" />
                </Button>
                <div className={primaryStyles.divider} />
                {/* Entry-aware (#1824 Q1): back to the editor if Play was
                    entered from there, else to View-idle. */}
                <Button
                  variant="toolbtn"
                  onClick={() => useStore.getState().stopPlaying()}
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
          auth dock. The primary action is always Edit; a signed-out
          visitor on a cloud scene is asked to sign in first. Same
          ProfileButton component as the editor, including its
          signed-out state. */}
      <div id="viewer-right-dock" className={`clickable ${styles.rightDock}`}>
        <div className={primaryStyles.wrapper}>
          {/* Capture-only snapshot (#1824 Q2): instant capture +
              non-blocking toast; no modal, no pause. The richer
              Capture & Render flow stays an editor action. */}
          <ViewerSnapshot />
          <div className={primaryStyles.divider} />
          {/* No "View only" label: the absence of edit controls plus an
              Edit / Sign in to Edit action already says this isn't edit
              mode; copy semantics surface via the unsaved-copy toast. */}
          <Button
            onClick={handleEnterEditor}
            variant="toolbtn"
            disabled={authPending}
            title={
              isAuthor
                ? undefined
                : needsAuthToEdit
                  ? intl.formatMessage({
                      id: 'viewer.signInToEditTitle',
                      defaultMessage:
                        'Sign in to open the editor — saving will create your own copy'
                    })
                  : intl.formatMessage({
                      id: 'viewer.editCopyTitle',
                      defaultMessage:
                        'Open the editor — saving will create your own copy'
                    })
            }
          >
            {needsAuthToEdit ? (
              <FormattedMessage
                id="viewer.signInToEdit"
                defaultMessage="Sign in to Edit"
              />
            ) : (
              <FormattedMessage id="toolbar.edit" defaultMessage="Edit" />
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
    </>
  );
}

export default Toolbar;
