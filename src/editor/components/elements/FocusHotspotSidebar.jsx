/* global AFRAME */
import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import PropertyRow from './PropertyRow';
import { Button } from './Button';
import { TextArea } from './TextArea';
import Events from '../../lib/Events';
import { setFocusCameraPose } from '../../lib/entity';

const fieldLabels = defineMessages({
  enabled: { id: 'focusHotspot.enabled', defaultMessage: 'Enabled' },
  title: { id: 'focusHotspot.title', defaultMessage: 'Title' },
  hideOnFocus: {
    id: 'focusHotspot.hideOnFocus',
    defaultMessage: 'Hide When Focused'
  },
  pulse: { id: 'focusHotspot.pulse', defaultMessage: 'Pulse To Invite Click' }
});

// Booleans + the one-line title render through the standard PropertyRow
// widgets; the description gets a real textarea below.
const PRIMARY_FIELDS = [
  { name: 'enabled' },
  { name: 'title' },
  { name: 'hideOnFocus' },
  { name: 'pulse' }
];

/**
 * Authoring panel for the focus-hotspot component: info-pane text, the
 * clickability options, and the two camera actions — capture the current
 * editor view as the hotspot's focus vantage (focus-camera-pose), and
 * preview the resulting glide.
 */
const FocusHotspotSidebar = ({ entity }) => {
  const intl = useIntl();
  const [, setUpdateTrigger] = useState(0);
  const componentName = 'focus-hotspot';
  const component = entity?.components?.[componentName];
  // Local draft so typing doesn't spam the undo stack; committed on blur.
  const [descriptionDraft, setDescriptionDraft] = useState(
    component?.data?.description ?? ''
  );

  useEffect(() => {
    setDescriptionDraft(
      entity?.components?.[componentName]?.data?.description ?? ''
    );
  }, [entity]);

  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity !== entity) return;
      if (detail.component === componentName) {
        setUpdateTrigger((p) => p + 1);
        if (detail.property === 'description') {
          setDescriptionDraft(detail.value ?? '');
        }
      }
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  if (!component || !component.schema || !component.data) return null;

  const commitDescription = () => {
    if (descriptionDraft === component.data.description) return;
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: componentName,
      property: 'description',
      value: descriptionDraft
    });
  };

  return (
    <div className="focus-hotspot-sidebar">
      <div className="details">
        {PRIMARY_FIELDS.map((f) =>
          component.schema[f.name] ? (
            <PropertyRow
              key={f.name}
              name={f.name}
              label={intl.formatMessage(fieldLabels[f.name])}
              schema={component.schema[f.name]}
              data={component.data[f.name]}
              componentname={componentName}
              isSingle={false}
              entity={entity}
            />
          ) : null
        )}
        <div className="propertyRow">
          <div className="text">
            <FormattedMessage
              id="focusHotspot.description"
              defaultMessage="Description"
            />
          </div>
        </div>
        <div className="propertyRow">
          <TextArea
            id="focusHotspotDescription"
            name="focusHotspotDescription"
            rows={5}
            value={descriptionDraft}
            onChange={(e) => setDescriptionDraft(e.target.value)}
            onBlur={commitDescription}
            placeholder={intl.formatMessage({
              id: 'focusHotspot.descriptionPlaceholder',
              defaultMessage: 'Shown in the info panel when a visitor clicks…'
            })}
          />
        </div>
        <div className="sidebar-buttons-small">
          <Button
            variant="toolbtn"
            onClick={() => setFocusCameraPose(entity)}
            title={intl.formatMessage({
              id: 'focusHotspot.setFocusViewTitle',
              defaultMessage:
                'Save the current editor camera as the view visitors fly to when they click this hotspot'
            })}
          >
            <FormattedMessage
              id="focusHotspot.setFocusView"
              defaultMessage="Set Focus View"
            />
          </Button>
          <Button
            variant="toolbtn"
            onClick={() => Events.emit('objectfocus', entity.object3D)}
            title={intl.formatMessage({
              id: 'focusHotspot.previewFocusTitle',
              defaultMessage: 'Fly the camera to this hotspot now'
            })}
          >
            <FormattedMessage
              id="focusHotspot.previewFocus"
              defaultMessage="Preview Focus"
            />
          </Button>
        </div>
        <div className="propertyRow">
          <div className="rounded bg-blue-50 p-2 text-gray-600">
            <FormattedMessage
              id="focusHotspot.tip"
              defaultMessage="💡 In view mode this becomes a clickable hotspot: visitors click it to fly in and read the info panel, then return to the overview."
            />
          </div>
        </div>
      </div>
    </div>
  );
};

FocusHotspotSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default FocusHotspotSidebar;
