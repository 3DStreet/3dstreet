import React from 'react';
import PropTypes from 'prop-types';

export default class NumberWidget extends React.Component {
  static propTypes = {
    id: PropTypes.string,
    max: PropTypes.number,
    min: PropTypes.number,
    name: PropTypes.string.isRequired,
    onChange: PropTypes.func,
    // Sentinel-friendly mode: when the value equals `emptyValue` the field
    // renders blank (with `placeholder`, e.g. "auto") instead of "0.00", and
    // clearing the field commits `emptyValue`. For schema props where 0
    // means "unset / use the model default" (street-generated-stencil's
    // stencilHeight).
    allowEmpty: PropTypes.bool,
    emptyValue: PropTypes.number,
    placeholder: PropTypes.string,
    precision: PropTypes.number,
    prefix: PropTypes.string,
    step: PropTypes.number,
    title: PropTypes.string,
    unit: PropTypes.string,
    value: PropTypes.number
  };

  static defaultProps = {
    min: -Infinity,
    max: Infinity,
    value: 0,
    precision: 3,
    step: 1,
    allowEmpty: false,
    emptyValue: 0
  };

  toDisplay(value) {
    if (typeof value !== 'number') return '';
    if (this.props.allowEmpty && value === this.props.emptyValue) return '';
    return value.toFixed(this.props.precision);
  }

  constructor(props) {
    super(props);
    this.state = {
      value: this.props.value,
      displayValue: this.toDisplay(this.props.value)
    };
    this.input = React.createRef();
  }

  componentDidMount() {
    this.distance = 0;
    this.onMouseDownValue = 0;
    this.prevPointer = [0, 0];
  }

  onMouseMove = (event) => {
    const currentValue = parseFloat(this.state.value);
    const pointer = [event.clientX, event.clientY];
    const delta =
      pointer[0] - this.prevPointer[0] - (pointer[1] - this.prevPointer[1]);
    this.distance += delta;

    // Add minimum tolerance to reduce unintentional drags when clicking on input.
    // if (Math.abs(delta) <= 2) { return; }

    let value =
      this.onMouseDownValue +
      ((this.distance / (event.shiftKey ? 5 : 50)) * this.props.step) / 2;
    value = Math.min(this.props.max, Math.max(this.props.min, value));
    if (currentValue !== value) {
      this.setValue(value);
    }
    this.prevPointer = [event.clientX, event.clientY];
  };

  onMouseDown = (event) => {
    event.preventDefault();
    this.distance = 0;
    this.onMouseDownValue = this.state.value;
    this.prevPointer = [event.clientX, event.clientY];
    document.addEventListener('mousemove', this.onMouseMove, false);
    document.addEventListener('mouseup', this.onMouseUp, false);
  };

  onMouseUp = () => {
    document.removeEventListener('mousemove', this.onMouseMove, false);
    document.removeEventListener('mouseup', this.onMouseUp, false);

    if (Math.abs(this.distance) < 2) {
      this.input.current.focus();
      this.input.current.select();
    }
  };

  setValue(value) {
    if (value === this.state.value) return;

    if (value !== undefined) {
      if (this.props.precision === 0) {
        value = parseInt(value);
      } else {
        value = parseFloat(value);
      }

      // If we inadvertently typed a character in the field, set value to the previous value from props
      if (isNaN(value)) {
        value = this.props.value;
      }

      if (value < this.props.min) {
        value = this.props.min;
      }
      if (value > this.props.max) {
        value = this.props.max;
      }

      this.setState({
        value: value,
        displayValue: this.toDisplay(value)
      });

      if (this.props.onChange) {
        this.props.onChange(this.props.name, parseFloat(value.toFixed(5)));
      }
    }
  }

  componentDidUpdate(prevProps) {
    // This will be triggered typically when the element is changed directly with
    // element.setAttribute.
    if (!Object.is(this.props.value, prevProps.value)) {
      this.setState({
        value: this.props.value,
        displayValue: this.toDisplay(this.props.value)
      });
    }
  }

  onBlur = () => {
    if (this.props.allowEmpty && this.input.current.value.trim() === '') {
      // Cleared field → back to the sentinel ("auto").
      if (this.state.value !== this.props.emptyValue) {
        this.setState({
          value: this.props.emptyValue,
          displayValue: ''
        });
        this.props.onChange?.(this.props.name, this.props.emptyValue);
      } else {
        this.setState({ displayValue: '' });
      }
      return;
    }
    // Untouched field (still showing the rendered value): a click-and-blur
    // must not re-commit the rounded display over the precise stored value.
    if (this.input.current.value === this.toDisplay(this.props.value)) return;
    this.setValue(parseFloat(this.input.current.value));
  };

  onChange = (e) => {
    this.setState({ value: e.target.value, displayValue: e.target.value });
  };

  onKeyDown = (event) => {
    event.stopPropagation();

    // enter.
    if (event.keyCode === 13) {
      this.input.current.blur();
      return;
    }

    // Arrow keys. Integer fields (precision 0) must step by at least 1 —
    // a 0.01 nudge gets truncated by setValue's parseInt, making ArrowUp a
    // no-op while ArrowDown steps -1. Float fields keep the fine 0.01 nudge.
    const arrowStep = this.props.precision === 0 ? this.props.step : 0.01;

    // up.
    if (event.keyCode === 38) {
      this.setValue(parseFloat(this.state.value) + arrowStep);
      return;
    }

    // down.
    if (event.keyCode === 40) {
      this.setValue(parseFloat(this.state.value) - arrowStep);
      return;
    }
  };

  render() {
    const helpString =
      ['x', 'y', 'z'].indexOf(this.props.name) !== -1 ? (
        <span className="axes"> {this.props.name}</span>
      ) : (
        ''
      );
    // A unit suffix ("m", "ft") renders inside the box, the way the vec3
    // axis letters do, so the field reads as one control. A short prefix
    // ("W", "PAD", "X") does the same at the start of the box.
    const blockClass = [
      'inputBlock',
      this.props.unit && 'has-unit',
      this.props.prefix && 'has-prefix'
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <div className={blockClass} title={this.props.title}>
        {helpString}
        {this.props.prefix && (
          <span className="prefix">{this.props.prefix}</span>
        )}
        <input
          id={this.props.id}
          ref={this.input}
          className="number"
          type="text"
          placeholder={this.props.placeholder}
          value={this.state.displayValue}
          onKeyDown={this.onKeyDown}
          onChange={this.onChange}
          onMouseDown={this.onMouseDown}
          onBlur={this.onBlur}
        />
        {this.props.unit && <span className="unit">{this.props.unit}</span>}
      </div>
    );
  }
}
