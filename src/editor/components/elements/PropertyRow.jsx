/* eslint-disable no-prototype-builtins */
import React from 'react';
import PropTypes from 'prop-types';

import BooleanWidget from '../widgets/BooleanWidget';
import ColorWidget from '../widgets/ColorWidget';
import InputWidget from '../widgets/InputWidget';
import NumberWidget from '../widgets/NumberWidget';
import SelectWidget from '../widgets/SelectWidget';
import TextureWidget from '../widgets/TextureWidget';
import Vec4Widget from '../widgets/Vec4Widget';
import Vec3Widget from '../widgets/Vec3Widget';
import Vec2Widget from '../widgets/Vec2Widget';
import { defineMessages, injectIntl } from 'react-intl';
import { AwesomeIcon } from './AwesomeIcon';
import { faArrowRotateLeft } from '@fortawesome/free-solid-svg-icons';
import { areVectorsEqual } from '../../lib/utils.js';

const messages = defineMessages({
  resetToDefault: {
    id: 'propertyRow.resetToDefault',
    defaultMessage: 'Reset to default ({value})'
  },
  linkAxes: {
    id: 'propertyRow.linkAxes',
    defaultMessage:
      'Link axes: editing one axis scales the others proportionally'
  },
  unlinkAxes: {
    id: 'propertyRow.unlinkAxes',
    defaultMessage: 'Unlink axes: edit each axis independently'
  }
});

const formatVec = (v) =>
  v && typeof v === 'object' ? `${v.x} ${v.y} ${v.z}` : String(v);

class PropertyRow extends React.Component {
  static propTypes = {
    intl: PropTypes.object.isRequired,
    componentname: PropTypes.string.isRequired,
    data: PropTypes.oneOfType([
      PropTypes.array.isRequired,
      PropTypes.bool.isRequired,
      PropTypes.number.isRequired,
      PropTypes.object.isRequired,
      PropTypes.string.isRequired
    ]),
    entity: PropTypes.object.isRequired,
    isSingle: PropTypes.bool,
    name: PropTypes.string.isRequired,
    label: PropTypes.string,
    schema: PropTypes.object.isRequired,
    noSelectEntity: PropTypes.bool,
    onEntityUpdate: PropTypes.func,
    onValueChange: PropTypes.func,
    rightElement: PropTypes.node
  };

  static defaultProps = {
    isSingle: false,
    noSelectEntity: false
  };

  constructor(props) {
    super(props);
    this.id = props.componentname + ':' + props.name;
  }

  getWidget() {
    const props = this.props;
    let type = props.schema.type;

    if (props.componentname === 'material' && props.name === 'envMap') {
      // material envMap has the wrong type string, force it to map
      type = 'map';
    }

    if (
      (props.componentname === 'animation' ||
        props.componentname.startsWith('animation__')) &&
      props.name === 'loop'
    ) {
      // The loop property can be a boolean for an infinite loop or a number to set the number of iterations.
      // It's auto detected as number because the default value is 0, but for most use case we want an infinite loop
      // so we're forcing the type to boolean. In the future we could create a custom widget to allow user to choose
      // between infinite loop and number of iterations.
      type = 'boolean';
    }

    const isSelectorType = type === 'selector' || type === 'selectorAll';

    const value = isSelectorType
      ? props.entity.getDOMAttribute(props.componentname)?.[props.name]
      : props.data;

    const updateProperty = (name, value) => {
      // Notify the parent of the raw user-initiated value change (used for
      // telemetry at the call site). Fired here rather than via onEntityUpdate
      // so it reflects a genuine widget interaction once, and does NOT re-fire
      // on undo/redo (which don't route through this handler).
      props.onValueChange?.(name, value);

      // Auto-switch to custom variant for building segments when modifying certain properties
      const shouldSwitchToCustom =
        // Surface changes on street-segment
        (props.componentname === 'street-segment' &&
          props.name === 'surface') ||
        // Any changes to clone components (building-related)
        props.componentname.startsWith('street-generated-clones');

      if (shouldSwitchToCustom) {
        const streetSegment = props.entity.getAttribute('street-segment');
        if (
          streetSegment &&
          streetSegment.type === 'boundary' &&
          streetSegment.variant !== 'custom'
        ) {
          // First switch to custom variant to prevent overrides
          AFRAME.INSPECTOR.execute('entityupdate', {
            entity: props.entity,
            component: 'street-segment',
            property: 'variant',
            value: 'custom',
            noSelectEntity: true
          });
        }
      }

      AFRAME.INSPECTOR.execute('entityupdate', {
        entity: props.entity,
        component: props.componentname,
        property: !props.isSingle ? props.name : '',
        value: value,
        noSelectEntity: props.noSelectEntity,
        onEntityUpdate: props.onEntityUpdate
      });
    };
    // The reset button in render() commits through the same path.
    this.updateProperty = updateProperty;

    // For selector and selectorAll types, commit on blur only (not on each
    // keystroke): a partial selector is rarely valid and querying the DOM on
    // every character is wasteful.
    const widgetProps = {
      name: props.name,
      ...(isSelectorType
        ? { onBlur: updateProperty }
        : { onChange: updateProperty }),
      value: value,
      id: this.id
    };
    const numberWidgetProps = {
      min: props.schema.hasOwnProperty('min') ? props.schema.min : -Infinity,
      max: props.schema.hasOwnProperty('max') ? props.schema.max : Infinity
    };

    if (props.schema.oneOf && props.schema.oneOf.length > 0) {
      return (
        <SelectWidget
          {...widgetProps}
          options={props.schema.oneOf}
          isMulti={props.schema.type === 'array'}
        />
      );
    }
    if (type === 'map') {
      return <TextureWidget {...widgetProps} />;
    }

    switch (type) {
      case 'number': {
        return <NumberWidget {...widgetProps} {...numberWidgetProps} />;
      }
      case 'int': {
        return (
          <NumberWidget {...widgetProps} {...numberWidgetProps} precision={0} />
        );
      }
      case 'vec2': {
        return <Vec2Widget {...widgetProps} />;
      }
      case 'vec3': {
        // Scale axes are linked by default (proportional editing); every
        // other vec3 keeps independent axes.
        const linkable = props.componentname === 'scale' && props.isSingle;
        return (
          <Vec3Widget
            {...widgetProps}
            linkable={linkable}
            linkTitle={props.intl.formatMessage(messages.linkAxes)}
            unlinkTitle={props.intl.formatMessage(messages.unlinkAxes)}
          />
        );
      }
      case 'vec4': {
        return <Vec4Widget {...widgetProps} />;
      }
      case 'color': {
        return <ColorWidget {...widgetProps} />;
      }
      case 'boolean': {
        return <BooleanWidget {...widgetProps} />;
      }
      default: {
        // For selector and selectorAll types, omit the schema so InputWidget
        // doesn't parse the string into a DOM element / NodeList. We want the
        // raw selector string to reach setAttribute — A-Frame preserves it
        // verbatim in attrValue, even when it doesn't resolve, so the UI
        // shows what the user typed.
        return (
          <InputWidget
            {...widgetProps}
            schema={isSelectorType ? undefined : props.schema}
          />
        );
      }
    }
  }

  // Circle-arrow reset beside vec3 inputs: restores the schema default
  // (position/rotation 0 0 0, scale 1 1 1, …) as one undoable update.
  // Disabled — not hidden — at the default so the row keeps its width.
  renderReset() {
    const props = this.props;
    const def = props.schema?.default;
    if (props.schema?.type !== 'vec3' || !def || typeof def !== 'object') {
      return null;
    }
    const atDefault = areVectorsEqual(props.data, def);
    return (
      <button
        type="button"
        className="vec3-tool vec3-reset"
        disabled={atDefault}
        onClick={() => this.updateProperty(props.name, { ...def })}
        title={props.intl.formatMessage(messages.resetToDefault, {
          value: formatVec(def)
        })}
        data-testid="vec3-reset"
      >
        <AwesomeIcon icon={faArrowRotateLeft} />
      </button>
    );
  }

  render() {
    const props = this.props;
    const value =
      props.schema.type === 'selector'
        ? props.entity.getDOMAttribute(props.componentname)?.[props.name]
        : JSON.stringify(props.data);
    const title =
      props.name + '\n - type: ' + props.schema.type + '\n - value: ' + value;

    return (
      <div className="propertyRow">
        <label
          htmlFor={this.id}
          className="text"
          title={title}
          style={props.label ? { textTransform: 'none' } : null}
        >
          {props.label || props.name}
        </label>
        {this.getWidget()}
        {this.renderReset()}
        {props.rightElement && (
          <div className="property-row-right-element">{props.rightElement}</div>
        )}
      </div>
    );
  }
}

export default injectIntl(PropertyRow);
