import PropTypes from 'prop-types';
import NumberWidget from '../widgets/NumberWidget';
import useStore from '@/store.js';

// A PropertyRow for a length stored in metres that displays and edits in the
// user's units preference (the Metric/Imperial toggle). The component value
// stays metres on disk and in every command; only the widget converts.
// Two decimals in both units, matching shapeMeasure.formatLength.

const M_TO_FT = 3.28084;

// Exported for other length-editing controls (segment panel width/slope
// fields) so every metre-backed field converts identically.
export const toDisplay = (m, units) => (units === 'imperial' ? m * M_TO_FT : m);
export const toMetres = (v, units) => (units === 'imperial' ? v / M_TO_FT : v);

const LengthPropertyRow = ({
  entity,
  componentname,
  name,
  label,
  schema,
  data,
  onValueChange
}) => {
  const units = useStore((s) => s.unitsPreference) || 'metric';
  const id = `${componentname}:${name}`;
  const value = typeof data === 'number' ? data : 0;

  const onChange = (_name, displayValue) => {
    // Round after converting so a typed "10 ft" doesn't store 3.0480001.
    const metres = parseFloat(toMetres(displayValue, units).toFixed(4));
    onValueChange?.(name, metres);
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity,
      component: componentname,
      property: name,
      value: metres
    });
  };

  const title = `${name}\n - type: ${schema.type}\n - value: ${value} m`;

  return (
    <div className="propertyRow">
      <label
        htmlFor={id}
        className="text"
        title={title}
        style={label ? { textTransform: 'none' } : null}
      >
        {label || name}
      </label>
      <NumberWidget
        id={id}
        name={name}
        value={toDisplay(value, units)}
        min={
          schema.min !== undefined ? toDisplay(schema.min, units) : -Infinity
        }
        max={schema.max !== undefined ? toDisplay(schema.max, units) : Infinity}
        precision={2}
        unit={units === 'imperial' ? 'ft' : 'm'}
        onChange={onChange}
      />
    </div>
  );
};

LengthPropertyRow.propTypes = {
  entity: PropTypes.object.isRequired,
  componentname: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  label: PropTypes.string,
  schema: PropTypes.object.isRequired,
  data: PropTypes.number,
  onValueChange: PropTypes.func
};

export default LengthPropertyRow;
