import { faEye, faEyeSlash, faPlay } from '@fortawesome/free-solid-svg-icons';
import { FormattedMessage, useIntl } from 'react-intl';
import useStore from '@/store';
import { useAuthContext } from '@/editor/contexts';
import { useHasPlayable } from '@/editor/hooks';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import { CameraSparkleIcon } from '@shared/icons';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import styles from './PrimaryToolbar.module.scss';

export const PrimaryToolbar = () => {
  const intl = useIntl();
  const panelsVisible = useStore((s) => s.panelsVisible);
  const togglePanelsVisible = useStore((s) => s.togglePanelsVisible);
  const { currentUser } = useAuthContext() || {};
  const hasPlayable = useHasPlayable();

  // Enter the Viewer from the editor camera's current pose (WYSIWYG).
  // When the scene has a playable capability the button reads "Play"
  // and also starts the simulation clock; otherwise it's just "View".
  const handleView = () => {
    useStore.getState().enterViewerMode('editor');
    if (hasPlayable) {
      document.querySelector('a-scene')?.systems?.['play-mode']?.start();
    }
  };

  const handleSnapshot = () => {
    if (currentUser && STREET.utils.getAuthorId() === currentUser.uid) {
      useStore.getState().saveScene(false);
    }
    makeScreenshot();
    useStore.getState().setModal('screenshot');
  };

  return (
    <div className={styles.wrapper}>
      <Button
        variant="toolbtn"
        onClick={togglePanelsVisible}
        title={intl.formatMessage({
          id: 'primaryToolbar.togglePanels',
          defaultMessage: 'Toggle panels visibility (`)'
        })}
        leadingIcon={
          <AwesomeIcon icon={panelsVisible ? faEyeSlash : faEye} size={16} />
        }
      >
        {panelsVisible
          ? intl.formatMessage({
              id: 'primaryToolbar.hidePanels',
              defaultMessage: 'Hide panels'
            })
          : intl.formatMessage({
              id: 'primaryToolbar.showPanels',
              defaultMessage: 'Show panels'
            })}
      </Button>
      <div className={styles.divider} />
      <Button
        variant="toolbtn"
        onClick={handleView}
        leadingIcon={
          <AwesomeIcon icon={hasPlayable ? faPlay : faEye} size={16} />
        }
        title={
          hasPlayable
            ? intl.formatMessage({
                id: 'primaryToolbar.playTitle',
                defaultMessage: 'Enter view mode and start the simulation'
              })
            : intl.formatMessage({
                id: 'primaryToolbar.viewTitle',
                defaultMessage: 'View the scene without editor panels'
              })
        }
      >
        {hasPlayable ? (
          <FormattedMessage id="primaryToolbar.play" defaultMessage="Play" />
        ) : (
          <FormattedMessage id="primaryToolbar.view" defaultMessage="View" />
        )}
      </Button>
      <div className={styles.divider} />
      <Button
        variant="toolbtn"
        onClick={handleSnapshot}
        leadingIcon={<CameraSparkleIcon />}
        title={intl.formatMessage({
          id: 'primaryToolbar.snapshotTitle',
          defaultMessage: 'Capture screenshot and generate rendered images'
        })}
      >
        <FormattedMessage
          id="primaryToolbar.snapshot"
          defaultMessage="Snapshot"
        />
      </Button>
    </div>
  );
};
