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
  enabled: { id: 'focusHotspot.enabled', defaultMessage: 'Enabled' }
});

// The toggle renders through the standard PropertyRow widget; the
// description gets a real textarea below. The info panel's title is the
// layer name, so there is no title field here.
const PRIMARY_FIELDS = [{ name: 'enabled' }];

/**
 * Body of the focus-hotspot component bar (rendered by FeaturedComponents
 * inside the standard collapsible Component header with icon + remove):
 * info-pane text, the clickability options, and the two camera actions —
 * capture the current editor view as the hotspot's focus vantage
 * (focus-camera-pose), and preview the resulting glide.
 */
export const FocusHotspotSectionControls = ({ entity }) => {
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
    <>
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
      <div className="roleSectionBody">
        <div className="text">
          <FormattedMessage
            id="focusHotspot.description"
            defaultMessage="Description"
          />
        </div>
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
        <div className="sidebar-buttons-small">
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
        </div>
        <div className="tip">
          <FormattedMessage
            id="focusHotspot.tip"
            defaultMessage="💡 In view mode visitors click this to fly in and read the info panel (the layer name is its title), then return to the overview. See-through hotspots pulse and hide themselves while focused."
          />
        </div>
      </div>
    </>
  );
};

FocusHotspotSectionControls.propTypes = {
  entity: PropTypes.object.isRequired
};
