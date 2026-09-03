import NumberWidget from './NumberWidget';
import PropTypes from 'prop-types';
import React from 'react';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { faLink, faLinkSlash } from '@fortawesome/free-solid-svg-icons';
import { areVectorsEqual } from '../../lib/utils.js';
import {
  linkedScaleUpdate,
  readScaleLinked,
  writeScaleLinked
} from '../../lib/linkedScale.js';

export default class Vec3Widget extends React.Component {
  static propTypes = {
    onChange: PropTypes.func,
    value: PropTypes.object.isRequired,
    // Show a link toggle; while linked, editing one axis scales the others
    // proportionally (scale rows). Off by default so position/rotation and
    // other vec3 props keep independent axes.
    linkable: PropTypes.bool,
    linkTitle: PropTypes.string,
    unlinkTitle: PropTypes.string
  };

  constructor(props) {
    super(props);
    this.state = {
      x: props.value.x,
      y: props.value.y,
      z: props.value.z,
      linked: props.linkable ? readScaleLinked() : false
    };
  }

  onChange = (name, value) => {
    const next =
      this.props.linkable && this.state.linked
        ? linkedScaleUpdate(this.state, name, parseFloat(value.toFixed(5)))
        : { [name]: parseFloat(value.toFixed(5)) };
    this.setState(next, () => {
      if (this.props.onChange) {
        const { x, y, z } = this.state;
        this.props.onChange(name, { x, y, z });
      }
    });
  };

  toggleLinked = () => {
    const linked = !this.state.linked;
    writeScaleLinked(linked);
    this.setState({ linked });
  };

  componentDidUpdate() {
    const props = this.props;
    if (!areVectorsEqual(props.value, this.state)) {
      this.setState({
        x: props.value.x,
        y: props.value.y,
        z: props.value.z
      });
    }
  }

  render() {
    const { linkable, linkTitle, unlinkTitle } = this.props;
    const { linked } = this.state;
    return (
      <div className="vec3">
        <NumberWidget name="x" value={this.state.x} onChange={this.onChange} />
        <NumberWidget name="y" value={this.state.y} onChange={this.onChange} />
        <NumberWidget name="z" value={this.state.z} onChange={this.onChange} />
        {linkable && (
          <button
            type="button"
            className={`vec3-tool vec3-link${linked ? ' vec3-link--on' : ''}`}
            onClick={this.toggleLinked}
            title={linked ? unlinkTitle : linkTitle}
            aria-pressed={linked}
            data-testid="vec3-link"
          >
            <AwesomeIcon icon={linked ? faLink : faLinkSlash} size={13} />
          </button>
        )}
      </div>
    );
  }
}
