import PropTypes from 'prop-types';
import { FormattedMessage, useIntl } from 'react-intl';
import { Button } from './Button';
import { setViewerStartToCurrentView } from '../../lib/entity';

/**
 * Body of the viewer-start component bar (rendered by FeaturedComponents
 * under the standard header; the schema's fov row renders generically
 * below): capture the current editor view as the start pose, and preview
 * the glide Start performs. Position/rotation live in the transform rows.
 */
export const ViewerStartSectionControls = ({ entity }) => {
  const intl = useIntl();
  const preview = () =>
    entity.sceneEl?.systems?.['viewer-start']?.goToStart(entity);

  return (
    <>
      <div className="sidebar-buttons-small">
        <Button
          variant="toolbtn"
          onClick={() => setViewerStartToCurrentView(entity)}
          title={intl.formatMessage({
            id: 'viewerStart.setToCurrentViewTitle',
            defaultMessage:
              'Move this start point to the current editor camera position and direction'
          })}
        >
          <FormattedMessage
            id="viewerStart.setToCurrentView"
            defaultMessage="Set To Current View"
          />
        </Button>
        <Button
          variant="toolbtn"
          onClick={preview}
          title={intl.formatMessage({
            id: 'viewerStart.previewTitle',
            defaultMessage: 'Fly the camera to this start point now'
          })}
        >
          <FormattedMessage
            id="viewerStart.preview"
            defaultMessage="Preview Start"
          />
        </Button>
      </div>
      <div className="propertyRow">
        <div className="rounded bg-blue-50 p-2 text-gray-600">
          <FormattedMessage
            id="viewerStart.tip"
            defaultMessage="💡 The scene's start view: visitors open the scene here and Start flies here. Setting a scene thumbnail moves it to the captured view. The marker is only visible while editing; you still edit from wherever you left off."
          />
        </div>
      </div>
    </>
  );
};

ViewerStartSectionControls.propTypes = {
  entity: PropTypes.object.isRequired
};
