import PropTypes from 'prop-types';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import posthog from 'posthog-js';
import PropertyRow from './PropertyRow';
import BooleanWidget from '../widgets/BooleanWidget';
import { Button } from './Button';
import { saveString } from '@/editor/lib/utils';
import { createUniqueId } from '@/editor/lib/entity.js';
import useStore from '@/store.js';
import { StreetToShapesGraphic } from '@/editor/components/modals/ConfirmModal/StreetToShapesGraphic';

// Shapes usable as a street path: any drawn polyline with at least 2
// vertices. A plain DOM query per render — fresh enough for a picker.
const getPathableShapes = () =>
  Array.from(document.querySelectorAll('a-entity[shape]')).filter(
    (el) => (el.components?.shape?.getVertexEls?.() || []).length >= 2
  );

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
  // Attached automatically by managed-street init (mode: auto): the street's
  // footprint flattens geospatial 3D tiles under it when the geo layer's
  // flattening master switch is on. The row toggles the contribution.
  const geoFlattenComponent = entity?.components?.['geo-flatten'];
  const sourceLabel = sourceLabels[component?.data?.sourceType];

  // Follow Path (curved streets): assign a drawn polyline as this street's
  // centerline. The selected value derives from the component itself so the
  // dropdown always shows what is actually assigned (incl. after undo/redo);
  // the tick only forces a re-render after a change.
  const [, setPathTick] = useState(0);
  const pathableShapes = getPathableShapes();
  const pathValue = component?.data?.path || '';
  const currentPathIndex = pathableShapes.findIndex(
    (el) => el.id && `#${el.id}` === pathValue
  );
  const onFollowPathChange = (e) => {
    const index = parseInt(e.target.value, 10);
    // re-query instead of closing over the render-time list: the DOM is the
    // source of truth, and assigning a missing id mutates the scene, not
    // React state
    const shapeEl = getPathableShapes()[index] || null;
    let value = '';
    if (shapeEl) {
      if (!shapeEl.id) {
        shapeEl.id = createUniqueId();
      }
      value = `#${shapeEl.id}`;
    }
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: componentName,
      property: 'path',
      value
    });
    // Shapes draw with hard corners (shape.curveType defaults to linear), but
    // a street centerline nearly always wants a curve — bump the shape to
    // smooth on assignment. Only HERE, at the user gesture: scene load
    // re-resolves paths too, and must never override a deliberate linear
    // choice. Undoable, and flipping it back in the shape panel sticks.
    if (shapeEl && shapeEl.components?.shape?.data?.curveType === 'linear') {
      AFRAME.INSPECTOR.execute('entityupdate', {
        entity: shapeEl,
        component: 'shape',
        property: 'curveType',
        value: 'smooth'
      });
    }
    setPathTick((t) => t + 1);
  };

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
    // A street following a path renders every surface as street-ribbon
    // geometry that resolves its curve from the live managed-street at build
    // time. Baked shapes have no managed-street to resolve against, so the
    // converted layer would be invisible (and stay invisible on reload).
    // Refuse rather than bake a broken layer; curve-preserving conversion is
    // tracked in #1720.
    if (entity.components['managed-street']?.streetCurve) {
      STREET.notify.warningMessage(
        intl.formatMessage({
          id: 'managedStreetSidebar.convertToShapesCurvedUnsupported',
          defaultMessage:
            'Convert to Shapes is not available for a street that follows a path yet. Clear the street\u2019s path first, or keep it as a managed street.'
        })
      );
      return;
    }
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
                {(pathableShapes.length > 0 || pathValue) && (
                  <div className="propertyRow" key="followPath">
                    <div className="fakePropertyRowLabel">Follow Path</div>
                    <div className="fakePropertyRowValue">
                      <select
                        value={currentPathIndex}
                        onChange={onFollowPathChange}
                      >
                        <option value={-1}>
                          {intl.formatMessage({
                            id: 'managedStreetSidebar.followPathNone',
                            defaultMessage: 'None (straight)'
                          })}
                        </option>
                        {pathableShapes.map((el, i) => (
                          <option key={el.id || i} value={i}>
                            {el.getAttribute('data-layer-name') ||
                              el.id ||
                              `Shape ${i + 1}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {pathValue && (
                  <div className="propertyRow" key="followPathHint">
                    <div className="rounded bg-blue-50 p-2 text-gray-600">
                      {intl.formatMessage({
                        id: 'managedStreetSidebar.followPathHint',
                        defaultMessage:
                          'This street follows a path — length tracks the path, and curve style (smooth / arc / linear) is set on the path shape.'
                      })}
                    </div>
                  </div>
                )}
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
                {geoFlattenComponent ? (
                  <PropertyRow
                    key="flattenTerrain"
                    name="enabled"
                    label="Flatten Terrain"
                    schema={geoFlattenComponent.schema.enabled}
                    data={geoFlattenComponent.data.enabled}
                    componentname="geo-flatten"
                    isSingle={false}
                    entity={entity}
                  />
                ) : (
                  // The component was removed (e.g. via Advanced Components);
                  // keep the toggle so flattening never dead-ends — checking
                  // it re-adds the default street footprint volume.
                  <div className="propertyRow" key="flattenTerrain">
                    <label
                      htmlFor="geo-flatten:add"
                      className="text"
                      style={{ textTransform: 'none' }}
                    >
                      Flatten Terrain
                    </label>
                    <BooleanWidget
                      id="geo-flatten:add"
                      name="enabled"
                      value={false}
                      onChange={() =>
                        AFRAME.INSPECTOR.execute('componentadd', {
                          entity,
                          component: 'geo-flatten',
                          value: 'mode: auto'
                        })
                      }
                    />
                  </div>
                )}
                <PropertyRow
                  key="playable"
                  name="playable"
                  label="Animate in Play"
                  schema={component.schema.playable}
                  data={component.data.playable}
                  componentname={componentName}
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
