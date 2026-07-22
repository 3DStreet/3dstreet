import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import NumberWidget from './NumberWidget';

// Shared opacity slider row (material opacity #1741, street-geo map opacity
// #1738). Renders a range slider plus either a read-only value readout
// (formatValue) or an editable NumberWidget (showNumberInput). Styled by the
// shared `.opacity-row .opacity-slider` rule in components.scss.
//
// Commits are coalesced through requestAnimationFrame: a slider drag fires
// 60–120 input events per second and each committed entityupdate can fan out
// to expensive scene work (street-geo → google-maps-aerial walks every
// cached tile scene), so only the latest value per animation frame is
// forwarded to onCommit.
const OpacitySliderRow = ({
  id,
  label,
  min,
  max,
  step,
  value,
  onCommit,
  formatValue,
  showNumberInput
}) => {
  const pendingValue = useRef(null);
  const rafId = useRef(0);

  useEffect(() => () => cancelAnimationFrame(rafId.current), []);

  const scheduleCommit = (newValue) => {
    pendingValue.current = newValue;
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        onCommit(pendingValue.current);
      });
    }
  };

  return (
    <div className="propertyRow opacity-row">
      <label className="text" htmlFor={id} style={{ textTransform: 'none' }}>
        {label}
      </label>
      <div className="opacity-slider">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => scheduleCommit(parseFloat(e.target.value))}
        />
        {showNumberInput ? (
          <NumberWidget
            id={`${id}-number`}
            name={id}
            min={min}
            max={max}
            precision={step >= 1 ? 0 : 2}
            value={value}
            onChange={(name, newValue) => scheduleCommit(newValue)}
          />
        ) : (
          <span className="opacity-value">{formatValue(value)}</span>
        )}
      </div>
    </div>
  );
};

OpacitySliderRow.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.node.isRequired,
  min: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired,
  step: PropTypes.number.isRequired,
  value: PropTypes.number.isRequired,
  onCommit: PropTypes.func.isRequired,
  formatValue: PropTypes.func,
  showNumberInput: PropTypes.bool
};

export default OpacitySliderRow;
