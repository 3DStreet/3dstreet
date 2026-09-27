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
    <div className="roleSectionBody">
      <div className="sidebar-buttons-small">
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
      </div>
      <div className="tip">
        <FormattedMessage
          id="viewerStart.tip"
          defaultMessage="💡 Visitors open the scene from this view and Start flies here. Setting a scene thumbnail also moves it to the captured view. The marker is only visible while editing; you still edit from wherever you left off."
        />
      </div>
    </div>
  );
};

ViewerStartSectionControls.propTypes = {
  entity: PropTypes.object.isRequired
};
