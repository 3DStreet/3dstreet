import PropTypes from 'prop-types';
import { useEffect, useReducer, useState } from 'react';
import { useIntl } from 'react-intl';
import posthog from 'posthog-js';
import LengthPropertyRow, { toDisplay } from './LengthPropertyRow';
import StreetCrossSectionStrip from './StreetCrossSectionStrip';
import AdvancedComponents from './AdvancedComponents';
import CommonComponents from './CommonComponents';
import EntityLabel from '../scenegraph/EntityLabel';
import EntityActionButtons, { IconButton } from './EntityActionButtons';
import Events from '../../lib/Events';
import { saveString } from '@/editor/lib/utils';
import { canRenameEntity, createUniqueId } from '@/editor/lib/entity.js';
import useStore from '@/store.js';
import { StreetToShapesGraphic } from '@/editor/components/modals/ConfirmModal/StreetToShapesGraphic';

// Condensed managed-street sidebar (#1753 companion, design option 3a):
// sticky header + shared cross-section strip on top, then Length, a Shape
// (straight / follow path) control with an inline path picker, a "Show" chip
// group for the visibility booleans, sentence-toggle rows for Flattening and
// Play, a Source card (logo · imported-from · open/reload) and the Street
// JSON / To shapes / Advanced footer. Every write still goes through the
// inspector's undoable command path.

const componentName = 'managed-street';

// Shapes usable as a street path: any drawn polyline with at least 2
// vertices. A plain DOM query per render — fresh enough for a picker.
const getPathableShapes = () =>
  Array.from(document.querySelectorAll('a-entity[shape]')).filter(
    (el) => (el.components?.shape?.getVertexEls?.() || []).length >= 2
  );

// --- inline glyphs from the 3a mock (24 viewBox, stroke 2, currentColor) ---
const StreetPanelIcons = {
  straight: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M3 12h18" />
    </svg>
  ),
  curve: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    >
      <path d="M3 20c6 0 4-16 10-16s4 16 8 16" />
    </svg>
  ),
  shapeRow: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 20C8 20 6 6 12 6s4 12 8 12" />
    </svg>
  ),
  plus: (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  boundaries: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M4 21V6l8-3 8 3v15M9 10h2M13 10h2M9 14h2M13 14h2" />
    </svg>
  ),
  ground: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="13" width="18" height="7" rx="1" />
      <path d="M3 9h18" strokeDasharray="3 3" />
    </svg>
  ),
  striping: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 3v18M20 3v18" />
      <path d="M12 3v4M12 10v4M12 17v4" />
    </svg>
  ),
  vehicles: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M2 16v-4l2.5-6h10l4 6H21v4" />
      <path d="M2 16h2.5M9.5 16h5M19 16h3M9 6v6M9 12h7.5" />
      <circle cx="7" cy="17" r="2" />
      <circle cx="17" cy="17" r="2" />
      <circle cx="19.8" cy="13.3" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  labels: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M20 12l-8 8-9-9V4h7l10 8z" />
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" />
    </svg>
  ),
  mountain: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="2"
      strokeLinejoin="round"
    >
      <path d="M3 20l6-9 4 6 3-4 5 7z" />
      <path d="M3 20h18" />
    </svg>
  ),
  play: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff">
      <path d="M6 4l14 8-14 8z" />
    </svg>
  ),
  download: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M12 3v12M6 9l6 6 6-6M4 21h16" />
    </svg>
  ),
  shapes: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="8" cy="8" r="4.5" />
      <rect x="11.5" y="11.5" width="9" height="9" rx="1" />
    </svg>
  ),
  external: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  ),
  reload: (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  )
};

// Presentational 34×18 toggle (the row/chip owns the click; unlike
// BooleanWidget it carries no handler of its own, so a row click never
// double-toggles).
const MiniToggle = ({ checked }) => (
  <div className={'checkboxAnim' + (checked ? ' checked' : '')}>
    <input type="checkbox" checked={checked} readOnly tabIndex={-1} />
    <label />
  </div>
);
MiniToggle.propTypes = { checked: PropTypes.bool };

const stripProtocol = (url) => (url || '').replace(/^[a-z]+:\/\//i, '');

const ManagedStreetSidebar = ({ entity }) => {
  const intl = useIntl();
  const showConfirm = useStore((state) => state.showConfirm);
  const units = useStore((s) => s.unitsPreference) || 'metric';
  const [pathPickerOpen, setPathPickerOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [, forceRender] = useReducer((t) => t + 1, 0);

  // Chips, toggles and the source card all derive from live entity data, so
  // re-render on any update to this entity (incl. undo/redo) — the parent
  // Sidebar only refreshes for a fixed set of component names.
  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity === entity) forceRender();
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  const component = entity?.components?.[componentName];
  const labelComponent = entity?.components?.['street-label'];
  // Attached automatically by managed-street init (mode: auto): the street's
  // footprint flattens geospatial 3D tiles under it when the geo layer's
  // flattening master switch is on. The row toggles the contribution.
  const geoFlattenComponent = entity?.components?.['geo-flatten'];

  const execute = (component, property, value) =>
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component,
      property,
      value
    });

  const pathValue = component?.data?.path || '';
  const followPath = pathValue !== '' || pathPickerOpen;
  const pathableShapes = getPathableShapes();
  // With a path assigned and the picker closed, list only the assigned
  // shape; the picker opens the full list (see "Change path").
  const listedShapes =
    pathValue && !pathPickerOpen
      ? pathableShapes.filter((el) => el.id && `#${el.id}` === pathValue)
      : pathableShapes;

  const chooseStraight = () => {
    setPathPickerOpen(false);
    if (pathValue) execute(componentName, 'path', '');
  };
  const chooseFollowPath = () => {
    if (!pathValue) setPathPickerOpen(true);
  };
  const pickShape = (shapeEl) => {
    // The DOM is the source of truth; assigning a missing id mutates the
    // scene, not React state.
    if (!shapeEl.id) {
      shapeEl.id = createUniqueId();
    }
    execute(componentName, 'path', `#${shapeEl.id}`);
    // Shapes draw with hard corners (shape.curveType defaults to linear), but
    // a street centerline nearly always wants a curve — bump the shape to
    // smooth on assignment. Only HERE, at the user gesture: scene load
    // re-resolves paths too, and must never override a deliberate linear
    // choice. Undoable, and flipping it back in the shape panel sticks.
    // noSelectEntity keeps the street selected — without it the command
    // would jump selection to the shape and close this panel mid-pick.
    if (shapeEl.components?.shape?.data?.curveType === 'linear') {
      AFRAME.INSPECTOR.execute('entityupdate', {
        entity: shapeEl,
        component: 'shape',
        property: 'curveType',
        value: 'smooth',
        noSelectEntity: true
      });
    }
    setPathPickerOpen(false);
  };
  const drawNewPath = () => {
    // Enters the existing shape-draw tool; assign the new shape here after.
    Events.emit('toolchange', 'shape');
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
            'Convert to Shapes is not available for a street that follows a path yet. Clear the street’s path first, or keep it as a managed street.'
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

  const reloadFromSource = (sourceName) => {
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
          { source: sourceName }
        )
      )
    ) {
      AFRAME.INSPECTOR.execute('streetreload', { entity });
    }
  };

  if (!component || !component.schema || !component.data) {
    return <div className="segment-panel street-panel" />;
  }
  const data = component.data;

  // Source card facts. `json-blob` is ambiguous today (template street vs.
  // imported .managed-street.json) — until a sourceOrigin schema property
  // exists (see design handoff §4), json-blob reads as "Created in 3DStreet".
  const source = (() => {
    if (data.sourceType === 'streetmix-url') {
      return {
        kind: 'streetmix',
        name: 'Streetmix',
        imported: true,
        ref: stripProtocol(data.sourceValue)
      };
    }
    if (data.sourceType === 'streetplan-url') {
      return {
        kind: 'streetplan',
        name: 'StreetPlan',
        imported: true,
        ref: stripProtocol(data.sourceValue)
      };
    }
    return {
      kind: '3dstreet',
      name: '3DStreet',
      imported: false,
      ref: intl.formatMessage({
        id: 'managedStreetSidebar.savedWithScene',
        defaultMessage: 'Saved with this scene'
      })
    };
  })();

  const chips = [
    {
      key: 'showBoundaries',
      component: componentName,
      property: 'showBoundaries',
      value: data.showBoundaries,
      icon: StreetPanelIcons.boundaries,
      label: intl.formatMessage({
        id: 'managedStreetSidebar.chipBoundaries',
        defaultMessage: 'Boundaries'
      })
    },
    {
      key: 'showGround',
      component: componentName,
      property: 'showGround',
      value: data.showGround,
      icon: StreetPanelIcons.ground,
      label: intl.formatMessage({
        id: 'managedStreetSidebar.chipGround',
        defaultMessage: 'Ground'
      })
    },
    {
      key: 'showStriping',
      component: componentName,
      property: 'showStriping',
      value: data.showStriping,
      icon: StreetPanelIcons.striping,
      label: intl.formatMessage({
        id: 'managedStreetSidebar.chipStriping',
        defaultMessage: 'Striping'
      })
    },
    {
      key: 'showVehicles',
      component: componentName,
      property: 'showVehicles',
      value: data.showVehicles,
      icon: StreetPanelIcons.vehicles,
      label: intl.formatMessage({
        id: 'managedStreetSidebar.chipVehicles',
        defaultMessage: 'Vehicles'
      })
    },
    ...(labelComponent
      ? [
          {
            key: 'labels',
            component: 'street-label',
            property: 'enabled',
            value: labelComponent.data?.enabled,
            icon: StreetPanelIcons.labels,
            label: intl.formatMessage({
              id: 'managedStreetSidebar.chipLabels',
              defaultMessage: 'Labels'
            })
          }
        ]
      : [])
  ];

  const flattenOn = !!geoFlattenComponent?.data?.enabled;
  const toggleFlatten = () => {
    if (geoFlattenComponent) {
      execute('geo-flatten', 'enabled', !flattenOn);
    } else {
      // The component was removed (e.g. via Advanced Components); keep the
      // toggle so flattening never dead-ends — turning it on re-adds the
      // default street footprint volume.
      AFRAME.INSPECTOR.execute('componentadd', {
        entity,
        component: 'geo-flatten',
        value: 'mode: auto'
      });
    }
  };

  const lengthDrivenByPath = pathValue !== '';

  return (
    <div className="segment-panel street-panel">
      <div className="segment-sticky">
        <div className="segment-header">
          <span className="segment-title">
            <EntityLabel entity={entity} editable={canRenameEntity(entity)} />
          </span>
          <EntityActionButtons entity={entity} />
        </div>
        <StreetCrossSectionStrip entity={entity} variant="street" />
      </div>
      <div className="segment-block">
        {lengthDrivenByPath ? (
          <div className="compact-row">
            <label className="compact-label">
              {intl.formatMessage({
                id: 'managedStreetSidebar.length',
                defaultMessage: 'Length'
              })}
            </label>
            <div
              className="inputBlock has-unit length-readonly"
              title={intl.formatMessage({
                id: 'managedStreetSidebar.pathHintFollows',
                defaultMessage:
                  'Length follows the path. Curve style is set on the shape.'
              })}
            >
              <span className="readonly-value">
                {toDisplay(data.length || 0, units).toFixed(2)}
              </span>
              <span className="unit">{units === 'imperial' ? 'ft' : 'm'}</span>
            </div>
          </div>
        ) : (
          <LengthPropertyRow
            key="length"
            name="length"
            label={intl.formatMessage({
              id: 'managedStreetSidebar.length',
              defaultMessage: 'Length'
            })}
            schema={component.schema.length}
            data={data.length}
            componentname={componentName}
            entity={entity}
          />
        )}
        <div className="compact-row">
          <label className="compact-label">
            {intl.formatMessage({
              id: 'managedStreetSidebar.shape',
              defaultMessage: 'Shape'
            })}
          </label>
          <div className="segmented-group shape-control">
            <button
              type="button"
              className={
                'segmented-option' + (!followPath ? ' is-selected' : '')
              }
              onClick={chooseStraight}
            >
              {StreetPanelIcons.straight}
              {intl.formatMessage({
                id: 'managedStreetSidebar.shapeStraight',
                defaultMessage: 'straight'
              })}
            </button>
            <button
              type="button"
              className={
                'segmented-option shape-follow' +
                (followPath ? ' is-selected' : '')
              }
              onClick={chooseFollowPath}
            >
              {StreetPanelIcons.curve}
              {intl.formatMessage({
                id: 'managedStreetSidebar.shapeFollowPath',
                defaultMessage: 'follow path'
              })}
            </button>
          </div>
        </div>
        {followPath && (
          <div className="compact-row path-picker-row">
            <label className="compact-label">
              {intl.formatMessage({
                id: 'managedStreetSidebar.path',
                defaultMessage: 'Path'
              })}
            </label>
            <div className="path-picker">
              {/* Assigned: one row for the current path + "Change" (the
                  full list is comically long in a scene with many shapes).
                  Picking: the whole list, capped to a scrolling height. */}
              {listedShapes.length > 0 && (
                <div className="path-picker-list">
                  {listedShapes.map((el, i) => {
                    const selected = el.id && `#${el.id}` === pathValue;
                    const vertexCount = (
                      el.components?.shape?.getVertexEls?.() || []
                    ).length;
                    const curveType =
                      el.components?.shape?.data?.curveType || '';
                    return (
                      <button
                        type="button"
                        key={el.id || i}
                        className={
                          'path-picker-shape' + (selected ? ' is-selected' : '')
                        }
                        onClick={() => pickShape(el)}
                      >
                        {StreetPanelIcons.shapeRow}
                        <span className="path-picker-name">
                          {el.getAttribute('data-layer-name') ||
                            el.id ||
                            `Shape ${i + 1}`}
                        </span>
                        <span className="path-picker-meta">
                          {intl.formatMessage(
                            {
                              id: 'managedStreetSidebar.pathPoints',
                              defaultMessage:
                                '{count, plural, one {# point} other {# points}}'
                            },
                            { count: vertexCount }
                          )}
                          {curveType ? ` · ${curveType}` : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="path-picker-actions">
                {pathValue &&
                  !pathPickerOpen &&
                  pathableShapes.length > listedShapes.length && (
                    <button
                      type="button"
                      className="path-picker-draw"
                      onClick={() => setPathPickerOpen(true)}
                    >
                      {intl.formatMessage({
                        id: 'managedStreetSidebar.changePath',
                        defaultMessage: 'Change path…'
                      })}
                    </button>
                  )}
                <button
                  type="button"
                  className="path-picker-draw"
                  onClick={drawNewPath}
                >
                  {StreetPanelIcons.plus}
                  {intl.formatMessage({
                    id: 'managedStreetSidebar.drawNewPath',
                    defaultMessage: 'Draw a new path'
                  })}
                </button>
              </div>
              {!pathValue && (
                <div className="path-picker-hint">
                  {intl.formatMessage({
                    id: 'managedStreetSidebar.pathHintPick',
                    defaultMessage:
                      'Pick a drawn shape with 2+ points, or draw one.'
                  })}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="compact-row show-chips-row">
          <label className="compact-label">
            {intl.formatMessage({
              id: 'managedStreetSidebar.show',
              defaultMessage: 'Show'
            })}
          </label>
          <div className="chip-group">
            {chips.map((chip) => (
              <button
                type="button"
                key={chip.key}
                role="checkbox"
                aria-checked={!!chip.value}
                className={'show-chip' + (chip.value ? ' is-on' : '')}
                onClick={() =>
                  execute(chip.component, chip.property, !chip.value)
                }
              >
                {chip.icon}
                {chip.label}
              </button>
            ))}
          </div>
        </div>
        <div className="compact-row">
          <label className="compact-label">
            {intl.formatMessage({
              id: 'managedStreetSidebar.flattening',
              defaultMessage: 'Flattening'
            })}
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={flattenOn}
            className="sentence-row inline-toggle"
            onClick={toggleFlatten}
          >
            {StreetPanelIcons.mountain}
            <span className="sentence-text">
              {intl.formatMessage({
                id: 'managedStreetSidebar.flattenSentence',
                defaultMessage: 'Flatten terrain under street'
              })}
            </span>
            <MiniToggle checked={flattenOn} />
          </button>
        </div>
        <div className="compact-row">
          <label className="compact-label">
            {intl.formatMessage({
              id: 'managedStreetSidebar.play',
              defaultMessage: 'Play'
            })}
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={!!data.playable}
            className="sentence-row inline-toggle"
            onClick={() => execute(componentName, 'playable', !data.playable)}
          >
            {StreetPanelIcons.play}
            <span className="sentence-text">
              {intl.formatMessage({
                id: 'managedStreetSidebar.playSentence',
                defaultMessage: 'Animate traffic in Play'
              })}
            </span>
            <MiniToggle checked={!!data.playable} />
          </button>
        </div>
        <div className="source-section">
          <div className="source-card">
            <div className={`source-logo source-logo-${source.kind}`}>
              {source.kind === 'streetmix' && (
                <img src="ui_assets/streetmix-logo.svg" alt="" />
              )}
              {source.kind === 'streetplan' && <span>SP</span>}
              {source.kind === '3dstreet' && (
                <img src="ui_assets/3D-St-stacked-128.png" alt="" />
              )}
            </div>
            <div className="source-text">
              <div className="source-line1">
                <span className="source-verb">
                  {source.imported
                    ? intl.formatMessage({
                        id: 'managedStreetSidebar.importedFrom',
                        defaultMessage: 'Imported from'
                      })
                    : intl.formatMessage({
                        id: 'managedStreetSidebar.createdIn',
                        defaultMessage: 'Created in'
                      })}
                </span>{' '}
                {source.name}
              </div>
              <div className="source-ref" title={source.ref}>
                {source.ref}
              </div>
            </div>
            {source.imported && (
              <>
                <IconButton
                  title={intl.formatMessage(
                    {
                      id: 'managedStreetSidebar.openInSource',
                      defaultMessage: 'Open in {source}'
                    },
                    { source: source.name }
                  )}
                  onClick={() =>
                    window.open(data.sourceValue, '_blank', 'noopener')
                  }
                >
                  {StreetPanelIcons.external}
                </IconButton>
                <IconButton
                  title={intl.formatMessage(
                    {
                      id: 'managedStreetSidebar.reloadFromSourceTitle',
                      defaultMessage:
                        'Reload from {source} — replaces local edits'
                    },
                    { source: source.name }
                  )}
                  onClick={() => reloadFromSource(source.name)}
                >
                  {StreetPanelIcons.reload}
                </IconButton>
              </>
            )}
          </div>
          <div className="street-footer">
            <button
              type="button"
              className="street-json-btn"
              onClick={downloadStreetJSON}
            >
              {StreetPanelIcons.download}
              {intl.formatMessage({
                id: 'managedStreetSidebar.streetJSON',
                defaultMessage: 'Street JSON'
              })}
            </button>
            <button
              type="button"
              className="to-shapes-btn"
              onClick={convertToShapes}
            >
              {StreetPanelIcons.shapes}
              {intl.formatMessage({
                id: 'managedStreetSidebar.toShapes',
                defaultMessage: 'To shapes…'
              })}
            </button>
            <button
              type="button"
              className={'advanced-btn' + (showAdvanced ? ' is-open' : '')}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {intl.formatMessage({
                id: 'segmentSidebar.advanced',
                defaultMessage: 'Advanced'
              })}
            </button>
          </div>
        </div>
      </div>
      {showAdvanced && (
        <div className="advancedComponentsContainer">
          {/* Transform rows lived in ComponentsContainer before this panel
              replaced it — keep them reachable under Advanced. */}
          <CommonComponents entity={entity} />
          <AdvancedComponents entity={entity} />
        </div>
      )}
    </div>
  );
};

ManagedStreetSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

export default ManagedStreetSidebar;
