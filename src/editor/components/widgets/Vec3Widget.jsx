import NumberWidget from './NumberWidget';
import PropTypes from 'prop-types';
import React from 'react';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { faLink, faLinkSlash } from '@fortawesome/free-solid-svg-icons';
import { areVectorsEqual } from '../../lib/utils.js';
import {
  isUniformScale,
  linkedScaleUpdate,
  readScaleLinked,
  writeScaleLinked
} from '../../lib/linkedScale.js';

export default class Vec3Widget extends React.Component {
  static propTypes = {
    onChange: PropTypes.func,
    value: PropTypes.object.isRequired,
    // Show a link toggle; while linked (and the axes are already equal),
    // editing one axis writes the same value to all three (scale rows). Off
    // by default so position/rotation and other vec3 props keep independent
    // axes.
    linkable: PropTypes.bool,
    // For a scale that must stay uniform (a user group): the axes are always
    // linked, the toggle is hidden and the stored link preference is neither
    // read nor written, so it keeps its value for every other entity. A
    // scale that is already uneven is shown read-only until reset.
    forceLinked: PropTypes.bool,
    linkTitle: PropTypes.string,
    unlinkTitle: PropTypes.string,
    // Tooltip while the link is unavailable because the axes differ.
    linkUnavailableTitle: PropTypes.string
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

  // Linking only applies to a uniform scale; a non-uniform one (e.g. after
  // unlinked edits) keeps independent axes until reset makes it uniform.
  isLinkActive() {
    const { linkable, forceLinked } = this.props;
    return (
      linkable &&
      (forceLinked || this.state.linked) &&
      isUniformScale(this.state)
    );
  }

  onChange = (name, value) => {
    const rounded = parseFloat(value.toFixed(5));
    const next = this.isLinkActive()
      ? linkedScaleUpdate(rounded)
      : { [name]: rounded };
    this.setState(next, () => {
      if (this.props.onChange) {
        const { x, y, z } = this.state;
        this.props.onChange(name, { x, y, z });
      }
    });
  };

  toggleLinked = () => {
    if (this.props.forceLinked) return;
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
    const {
      linkable,
      forceLinked,
      linkTitle,
      unlinkTitle,
      linkUnavailableTitle
    } = this.props;
    const { linked } = this.state;
    const uniform = isUniformScale(this.state);
    const readOnly = !!forceLinked && !uniform;
    const fieldProps = {
      onChange: this.onChange,
      readOnly,
      title: readOnly ? linkUnavailableTitle : undefined
    };
    return (
      <div className="vec3">
        <NumberWidget name="x" {...fieldProps} value={this.state.x} />
        <NumberWidget name="y" {...fieldProps} value={this.state.y} />
        <NumberWidget name="z" {...fieldProps} value={this.state.z} />
        {linkable && !forceLinked && (
          <button
            type="button"
            className={`vec3-tool vec3-link${
              linked && uniform ? ' vec3-link--on' : ''
            }`}
            onClick={this.toggleLinked}
            disabled={!uniform}
            title={
              !uniform ? linkUnavailableTitle : linked ? unlinkTitle : linkTitle
            }
            aria-pressed={linked && uniform}
            data-testid="vec3-link"
          >
            <AwesomeIcon icon={linked ? faLink : faLinkSlash} size={13} />
          </button>
        )}
      </div>
    );
  }
}
