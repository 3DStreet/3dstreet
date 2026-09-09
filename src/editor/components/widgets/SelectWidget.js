import React from 'react';
import PropTypes from 'prop-types';
import Select from 'react-select';

export default class SelectWidget extends React.Component {
  static propTypes = {
    id: PropTypes.string,
    isMulti: PropTypes.bool,
    name: PropTypes.string.isRequired,
    onChange: PropTypes.func,
    options: PropTypes.array.isRequired,
    // Optional custom option renderer, passed straight to react-select —
    // lets callers add swatches/icons next to values (segment Material).
    formatOptionLabel: PropTypes.func,
    value: PropTypes.oneOfType([
      PropTypes.number,
      PropTypes.string,
      PropTypes.array
    ]).isRequired
  };

  static defaultProps = {
    isMulti: false
  };

  constructor(props) {
    super(props);
    if (this.props.isMulti) {
      const value = this.props.value;
      this.state = {
        value: value.map((choice) => ({ value: choice, label: choice }))
      };
    } else {
      const value = this.props.value;
      this.state = { value: { value: value, label: value } };
    }
  }

  onChange = (value) => {
    this.setState({ value: value }, () => {
      if (this.props.onChange) {
        this.props.onChange(
          this.props.name,
          this.props.isMulti ? value.map((option) => option.value) : value.value
        );
      }
    });
  };

  componentDidUpdate(prevProps) {
    const props = this.props;
    if (props.value !== prevProps.value) {
      if (this.props.isMulti) {
        this.setState({
          value: props.value.map((choice) => ({ value: choice, label: choice }))
        });
      } else {
        this.setState({
          value: { value: props.value, label: props.value }
        });
      }
    }
  }

  render() {
    const options = this.props.options.map((value) => {
      return { value: value, label: value };
    });

    return (
      <Select
        id={this.props.id}
        className="select-widget"
        classNamePrefix="select"
        options={options}
        isMulti={this.props.isMulti}
        isClearable={false}
        isSearchable
        placeholder=""
        value={this.state.value}
        noOptionsMessage={() => 'No value found'}
        formatOptionLabel={this.props.formatOptionLabel}
        onChange={this.onChange}
        menuPosition="fixed"
        menuPlacement="auto"
        // Let the menu shrink (and scroll) in a short panel rather than
        // refuse to fit either way and get clipped.
        minMenuHeight={140}
        // The menu is fixed-positioned, so it can grow past the control:
        // let it size to its longest option (capped) instead of cramming
        // "dashed-yellow-double" into a 1fr compact-row cell.
        styles={{
          menu: (base) => ({
            ...base,
            width: 'max-content',
            minWidth: '100%',
            maxWidth: 320
          })
        }}
      />
    );
  }
}
