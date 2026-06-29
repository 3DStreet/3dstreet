import { useEffect, useReducer } from 'react';
import PropTypes from 'prop-types';
import Collapsible from '../Collapsible';
import PropertyRow from './PropertyRow';
import Events from '../../lib/Events';
import { Button } from '../elements';

// First-class material editing surfaced at the top of the properties sidebar.
//
// Curated rather than schema-dumped because the material component has ~30 props;
// this exposes only the ones non-technical users reach for (color, texture,
// opacity, roughness) plus two UX shortcuts called out in #1741:
//   - "Make Solid" drops the texture/SRC in one click so the flat color shows
//     through (the common case for AI mask boxes and massing blocks).
//   - A real opacity slider with live preview that also toggles `transparent`
//     so partial opacity actually renders.
const MaterialControls = ({ entity }) => {
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // Re-render when the material changes (incl. our own edits and external ones).
  useEffect(() => {
    const onEntityUpdate = (detail) => {
      if (detail.entity === entity && detail.component === 'material') {
        forceUpdate();
      }
    };
    Events.on('entityupdate', onEntityUpdate);
    return () => Events.off('entityupdate', onEntityUpdate);
  }, [entity]);

  const component = entity?.components?.material;
  if (!component || !component.schema || !component.data) {
    return null;
  }
  const schema = component.schema;
  const data = component.data;
  const hasTexture = !!data.src;
  const opacity = typeof data.opacity === 'number' ? data.opacity : 1;

  const makeSolidColor = () => {
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: 'material',
      property: 'src',
      value: '',
      noSelectEntity: true
    });
  };

  const setOpacity = (value) => {
    // A material only honors opacity < 1 when `transparent` is enabled, so keep
    // the two in sync. When transparent doesn't need to change we use a single
    // (updatable) entityupdate so dragging the slider collapses into one undo
    // step, matching NumberWidget behavior.
    const needTransparent = value < 1;
    if (!!data.transparent === needTransparent) {
      AFRAME.INSPECTOR.execute('entityupdate', {
        entity,
        component: 'material',
        property: 'opacity',
        value,
        noSelectEntity: true
      });
    } else {
      AFRAME.INSPECTOR.execute('multi', [
        [
          'entityupdate',
          {
            entity,
            component: 'material',
            property: 'opacity',
            value,
            noSelectEntity: true
          }
        ],
        [
          'entityupdate',
          {
            entity,
            component: 'material',
            property: 'transparent',
            value: needTransparent,
            noSelectEntity: true
          }
        ]
      ]);
    }
  };

  return (
    <div className="details material-controls">
      <Collapsible>
        <div className="componentHeader collapsible-header">
          <span className="componentTitle" title="material">
            <span>material</span>
          </span>
        </div>
        <div className="collapsible-content">
          {/* The material schema is dynamic per shader (e.g. shader:flat has no
            roughness), so each optional row is guarded by schema presence. */}
          {schema.color && (
            <PropertyRow
              name="color"
              label="Color"
              schema={schema.color}
              data={data.color}
              componentname="material"
              entity={entity}
            />
          )}
          {schema.src && (
            <PropertyRow
              name="src"
              label="Texture"
              schema={schema.src}
              data={data.src ?? ''}
              componentname="material"
              entity={entity}
              rightElement={
                hasTexture ? (
                  <Button variant="ghost" onClick={makeSolidColor}>
                    Make Solid
                  </Button>
                ) : null
              }
            />
          )}
          {hasTexture && schema.repeat && (
            <PropertyRow
              name="repeat"
              label="Texture Repeat"
              schema={schema.repeat}
              data={data.repeat}
              componentname="material"
              entity={entity}
            />
          )}
          <div className="propertyRow opacity-row">
            <label
              className="text"
              htmlFor="material-opacity"
              style={{ textTransform: 'none' }}
            >
              Opacity
            </label>
            <div className="opacity-slider">
              <input
                id="material-opacity"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
              />
              <span className="opacity-value">
                {Math.round(opacity * 100)}%
              </span>
            </div>
          </div>
          {schema.roughness && (
            <PropertyRow
              name="roughness"
              label="Roughness"
              schema={schema.roughness}
              data={data.roughness}
              componentname="material"
              entity={entity}
            />
          )}
        </div>
      </Collapsible>
    </div>
  );
};

MaterialControls.propTypes = {
  entity: PropTypes.object.isRequired
};

export default MaterialControls;
