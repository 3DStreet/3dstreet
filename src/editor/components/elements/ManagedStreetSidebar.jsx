import PropTypes from 'prop-types';
import { useIntl } from 'react-intl';
import posthog from 'posthog-js';
import PropertyRow from './PropertyRow';
import { Button } from './Button';
import { saveString } from '@/editor/lib/utils';
import useStore from '@/store.js';
import { StreetToShapesGraphic } from '@/editor/components/modals/ConfirmModal/StreetToShapesGraphic';

const sourceLabels = {
  'streetmix-url': 'Streetmix',
  'streetplan-url': 'StreetPlan'
};

const ManagedStreetSidebar = ({ entity }) => {
  const intl = useIntl();
  const showConfirm = useStore((state) => state.showConfirm);
  const componentName = 'managed-street';
  const labelComponentName = 'street-label';
  // Check if entity and its components exist
  const component = entity?.components?.[componentName];
  const labelComponent = entity?.components?.[labelComponentName];
  const sourceLabel = sourceLabels[component?.data?.sourceType];

  const downloadStreetJSON = () => {
    // Serializes the live DOM state (not the possibly-stale sourceValue blob)
    // into a Format-2 street object that re-imports via `sourceType: json-blob`.
    try {
      const streetJSON = window.STREET.utils.getManagedStreetJSON(entity);
      // Base the filename on the JSON's own `name` (already prefix-stripped by
      // getManagedStreetJSON) so the on-disk name matches the exported name;
      // strip characters that are invalid in filenames (same set as the scene
      // JSON download in SceneUtils).
      const sanitized =
        (streetJSON.name || 'street').replace(/[<>:"/\\|?*]+/g, '').trim() ||
        'street';
      // saveString handles the append-to-body + delayed revoke browser quirks.
      saveString(
        JSON.stringify(streetJSON, null, 2),
        `${sanitized}.managed-street.json`,
        'application/json'
      );
      // Capture after the download is triggered so the metric reflects an
      // actual export, not just a successful serialization.
      posthog.capture('export_initiated', {
        export_type: 'managed-street-json',
        scene_id: STREET.utils.getCurrentSceneId()
      });
      STREET.notify.successMessage('Street JSON file saved successfully.');
    } catch (error) {
      STREET.notify.errorMessage(
        `Error trying to save Street JSON file. Error: ${error}`
      );
      console.error(error);
    }
  };

  const convertToShapes = () => {
    // One-way workflow (undoable in-session): bakes the street into plain
    // entities and strips all managed components, so a saved scene keeps the
    // shapes, not the managed-street JSON.
    showConfirm({
      title: intl.formatMessage({
        id: 'managedStreetSidebar.convertToShapesTitle',
        defaultMessage: 'Convert Street to Shapes?'
      }),
      graphic: <StreetToShapesGraphic />,
      message: intl.formatMessage({
        id: 'managedStreetSidebar.convertToShapesConfirm',
        defaultMessage:
          'This turns the street into plain 3D shapes you can move, duplicate, and delete individually. After you save and reload this scene you cannot undo this action. Tip: duplicate the street first if you want to keep a copy of this managed street.'
      }),
      confirmLabel: intl.formatMessage({
        id: 'managedStreetSidebar.convertToShapes',
        defaultMessage: 'Convert to Shapes'
      }),
      onConfirm: () => {
        AFRAME.INSPECTOR.execute('streetconverttoshapes', { entity });
        posthog.capture('convert_street_to_shapes', {
          scene_id: STREET.utils.getCurrentSceneId()
        });
      }
    });
  };

  const reloadFromSource = () => {
    // Replaces all segments (and local edits) with the source; runs as a
    // command so the pre-reload street is restorable via undo.
    if (
      window.confirm(
        intl.formatMessage(
          {
            id: 'managedStreetSidebar.reloadConfirm',
            defaultMessage:
              'Reload this street from {source}? Local segment edits will be lost.'
          },
          { source: sourceLabel }
        )
      )
    ) {
      AFRAME.INSPECTOR.execute('streetreload', { entity });
    }
  };

  return (
    <div className="managed-street-sidebar">
      <div className="street-controls">
        <div className="details">
          {component &&
            component.schema &&
            component.data &&
            labelComponent &&
            labelComponent.schema &&
            labelComponent.data && (
              <>
                <PropertyRow
                  key="length"
                  name="length"
                  label="Street Length"
                  schema={component.schema.length}
                  data={component.data.length}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="showBoundaries"
                  name="showBoundaries"
                  label="Boundaries"
                  schema={component.schema.showBoundaries}
                  data={component.data.showBoundaries}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="showGround"
                  name="showGround"
                  label="Ground"
                  schema={component.schema.showGround}
                  data={component.data.showGround}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="showStriping"
                  name="showStriping"
                  label="Striping"
                  schema={component.schema.showStriping}
                  data={component.data.showStriping}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="showVehicles"
                  name="showVehicles"
                  label="Vehicles"
                  schema={component.schema.showVehicles}
                  data={component.data.showVehicles}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
                <PropertyRow
                  key="enabled"
                  name="enabled"
                  label="Labels"
                  schema={labelComponent.schema.enabled}
                  data={labelComponent.data.enabled}
                  componentname={labelComponentName}
                  isSingle={false}
                  entity={entity}
                />
                <div className="sidebar-buttons-stack">
                  {sourceLabel && (
                    <Button variant="toolbtn" onClick={reloadFromSource}>
                      {intl.formatMessage(
                        {
                          id: 'managedStreetSidebar.reloadFromSource',
                          defaultMessage: 'Reload from {source}'
                        },
                        { source: sourceLabel }
                      )}
                    </Button>
                  )}
                  <Button variant="toolbtn" onClick={downloadStreetJSON}>
                    {intl.formatMessage({
                      id: 'managedStreetSidebar.downloadJSON',
                      defaultMessage: 'Download Street JSON'
                    })}
                  </Button>
                  <Button variant="toolbtn" onClick={convertToShapes}>
                    {intl.formatMessage({
                      id: 'managedStreetSidebar.convertToShapes',
                      defaultMessage: 'Convert to Shapes'
                    })}
                  </Button>
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
};

ManagedStreetSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default ManagedStreetSidebar;
