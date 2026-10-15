import React from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';

export default class BooleanWidget extends React.Component {
  static propTypes = {
    id: PropTypes.string,
    name: PropTypes.string.isRequired,
    onChange: PropTypes.func,
    value: PropTypes.bool
  };

  static defaultProps = {
    value: false
  };

  constructor(props) {
    super(props);
    this.state = { value: this.props.value };
  }

  componentDidUpdate(prevProps) {
    if (this.props.value !== prevProps.value) {
      this.setState({ value: this.props.value });
    }
  }

  onChange = () => {
    const value = !this.state.value;

    this.setState({ value });
    if (this.props.onChange) {
      this.props.onChange(this.props.name, value);
    }
  };

  render() {
    const checkboxClasses = classNames({
      checkboxAnim: true,
      checked: this.state.value
    });

    return (
      <div className={checkboxClasses} onClick={this.onChange}>
        <input
          id={this.props.id}
          type="checkbox"
          checked={this.state.value}
          value={this.state.value}
          onChange={() => null}
        />
        <label htmlFor={this.props.id} onClick={(e) => e.stopPropagation()} />
      </div>
    );
  }
}
