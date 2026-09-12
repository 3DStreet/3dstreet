/* global AFRAME */
import PropTypes from 'prop-types';
import { useState, useEffect, useRef } from 'react';
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
  // Local draft so typing doesn't spam the undo stack; committed on blur
  // and after a typing pause (#1998) — the commit is an entityupdate
  // command, which is what the cloud autosave listens for, so a
  // description edit left sitting in the textarea still autosaves.
  const [descriptionDraft, setDescriptionDraft] = useState(
    component?.data?.description ?? ''
  );

  // Pending commit for the idle debounce. The entry carries its own entity
  // so a flush from a cleanup (entity switch, unmount) writes to the
  // entity the text was typed on, not whatever is selected by then.
  const pendingCommitRef = useRef(null);
  const commitTimerRef = useRef(null);
  const COMMIT_IDLE_MS = 2000;

  const flushPendingCommit = () => {
    clearTimeout(commitTimerRef.current);
    const pending = pendingCommitRef.current;
    pendingCommitRef.current = null;
    if (!pending) return;
    const pendingComponent = pending.entity?.components?.[componentName];
    if (!pendingComponent) return;
    if (pending.value === (pendingComponent.data?.description ?? '')) return;
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: pending.entity,
      component: componentName,
      property: 'description',
      value: pending.value,
      // A flush can run right after the user selects a different entity —
      // don't let the command yank the selection back here.
      noSelectEntity: true
    });
  };

  useEffect(() => {
    setDescriptionDraft(
      entity?.components?.[componentName]?.data?.description ?? ''
    );
    return flushPendingCommit;
  }, [entity]);

  // The debounce leaves a short window where the typed text is not yet
  // committed (and so not yet autosaved) — warn on tab close during it.
  const isDirty = descriptionDraft !== (component?.data?.description ?? '');
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

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

  const onDescriptionChange = (e) => {
    const value = e.target.value;
    setDescriptionDraft(value);
    pendingCommitRef.current = { entity, value };
    clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(flushPendingCommit, COMMIT_IDLE_MS);
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
          onChange={onDescriptionChange}
          onBlur={flushPendingCommit}
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
