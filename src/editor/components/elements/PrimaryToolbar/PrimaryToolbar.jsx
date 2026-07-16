import { faPlay } from '@fortawesome/free-solid-svg-icons';
import { FormattedMessage, useIntl } from 'react-intl';
import { Tooltip } from 'radix-ui';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { useHasPlayable } from '@/editor/hooks';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import { CameraSparkleIcon, PanelsIcon } from '@shared/icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import styles from './PrimaryToolbar.module.scss';

// Immediate (no-delay) tooltip matching the dark style used across the
// editor (RightPanel, Save, etc.). Replaces the browser's slow native
// `title` so hovering a toolbar button explains it instantly.
const ToolTip = ({ content, children }) => (
  <Tooltip.Root delayDuration={0}>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content side="bottom" sideOffset={5} className={styles.tooltip}>
        {content}
        <Tooltip.Arrow className={styles.tooltipArrow} />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);

export const PrimaryToolbar = () => {
  const intl = useIntl();
  const panelsVisible = useStore((s) => s.panelsVisible);
  const togglePanelsVisible = useStore((s) => s.togglePanelsVisible);
  const { currentUser } = useAuthContext() || {};
  const hasPlayable = useHasPlayable();

  // Enter the Viewer from the editor camera's current pose (WYSIWYG) and
  // run the simulation. Only rendered when the scene has a registered
  // playable capability (a driveable vehicle, playable street traffic, a
  // traffic replay layer, ...) — a static scene gets no button, since a
  // bare "View" presentation confused users more than it helped. "Start"
  // avoids the media-player baggage "Play" carries ("Reproducir"/
  // "Lecture") for a lay audience. (A future per-capability label can
  // say "Drive" etc.)
  const handlePlay = () => {
    useStore.getState().enterViewerMode('editor');
    document
      .querySelector('a-scene')
      ?.systems?.['play-mode']?.start({ origin: 'editor' });
  };

  const handleSnapshot = () => {
    if (currentUser && STREET.utils.getAuthorId() === currentUser.uid) {
      useStore.getState().saveScene(false);
    }
    makeScreenshot();
    useStore.getState().setModal('screenshot');
  };

  const panelsTooltip = panelsVisible
    ? intl.formatMessage({
        id: 'primaryToolbar.hidePanels',
        defaultMessage: 'Hide panels'
      })
    : intl.formatMessage({
        id: 'primaryToolbar.showPanels',
        defaultMessage: 'Show panels'
      });

  const playTooltip = intl.formatMessage({
    id: 'primaryToolbar.playTitle',
    defaultMessage: 'Enter View mode and run the simulation'
  });

  return (
    <div className={styles.wrapper}>
      <Tooltip.Provider>
        <ToolTip
          content={
            <>
              {panelsTooltip} <span className={styles.tooltipKbd}>`</span>
            </>
          }
        >
          <Button
            variant="toolbtn"
            onClick={togglePanelsVisible}
            aria-label={panelsTooltip}
            leadingIcon={<PanelsIcon filled={panelsVisible} size={16} />}
          />
        </ToolTip>
        {hasPlayable && (
          <>
            <div className={styles.divider} />
            <ToolTip content={playTooltip}>
              <Button
                variant="toolbtn"
                onClick={handlePlay}
                leadingIcon={<AwesomeIcon icon={faPlay} size={16} />}
              >
                <FormattedMessage
                  id="primaryToolbar.play"
                  defaultMessage="Start"
                />
              </Button>
            </ToolTip>
          </>
        )}
        <div className={styles.divider} />
        <ToolTip
          content={intl.formatMessage({
            id: 'primaryToolbar.snapshotTitle',
            defaultMessage: 'Capture screenshot and generate rendered images'
          })}
        >
          {/* "Capture & Render" (#1824 Q2): the editor keeps the richer
              modal flow (AI render, thumbnail, download); the Viewer has
              its own capture-only snapshot button. */}
          <Button
            variant="toolbtn"
            onClick={handleSnapshot}
            leadingIcon={<CameraSparkleIcon />}
          >
            <FormattedMessage
              id="primaryToolbar.captureRender"
              defaultMessage="Capture & Render"
            />
          </Button>
        </ToolTip>
      </Tooltip.Provider>
    </div>
  );
};
