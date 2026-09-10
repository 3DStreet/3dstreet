import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import PropertyRow from './PropertyRow';
import { Button } from './Button';
import Events from '../../lib/Events';
import { setViewerStartToCurrentView } from '../../lib/entity';

const fieldLabels = defineMessages({
  enabled: { id: 'viewerStart.enabled', defaultMessage: 'Enabled' }
});

/**
 * Authoring panel for the viewer-start entity: the enabled toggle plus the
 * two camera actions — capture the current editor view as the start pose,
 * and preview the glide Start will perform. Position/rotation live in the
 * shared transform rows above.
 */
const ViewerStartSidebar = ({ entity }) => {
  const intl = useIntl();
  const [, setUpdateTrigger] = useState(0);
  const componentName = 'viewer-start';
  const component = entity?.components?.[componentName];

  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity === entity && detail.component === componentName) {
        setUpdateTrigger((p) => p + 1);
      }
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  if (!component || !component.schema || !component.data) return null;

  const preview = () => {
    const system = entity.sceneEl?.systems?.['viewer-start'];
    system?.goToStart(entity);
  };

  return (
    <div className="viewer-start-sidebar">
      <div className="details">
        <PropertyRow
          name="enabled"
          label={intl.formatMessage(fieldLabels.enabled)}
          schema={component.schema.enabled}
          data={component.data.enabled}
          componentname={componentName}
          isSingle={false}
          entity={entity}
        />
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
              defaultMessage="💡 Pressing Start flies the camera here first, so visitors always begin from this view. The marker is only visible while editing. The scene thumbnail still sets where the scene opens."
            />
          </div>
        </div>
      </div>
    </div>
  );
};

ViewerStartSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default ViewerStartSidebar;
