import React from 'react';
import PropTypes from 'prop-types';
import Select, { components } from 'react-select';
import Events from '../../lib/Events';
import { DropdownArrowIcon } from '../../icons';

export default class ModelsArrayWidget extends React.Component {
  static propTypes = {
    entity: PropTypes.object.isRequired,
    componentname: PropTypes.string.isRequired
  };

  constructor(props) {
    super(props);
    this.state = { modelsArrayWidget: this.getModelsArrayValueForWidget() };
  }

  onEntityUpdate = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    if (detail.component === this.props.componentname) {
      this.setState({ modelsArrayWidget: this.getModelsArrayValueForWidget() });
    }
  };

  componentDidMount() {
    Events.on('entityupdate', this.onEntityUpdate);
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.props.entity === prevProps.entity) {
      return;
    }
    this.setState({ modelsArrayWidget: this.getModelsArrayValueForWidget() });
  }

  getModelsArrayValueForWidget() {
    console.log(this.props.entity.getAttribute(this.props.componentname));
    const modelsArrayRaw = this.props.entity.getAttribute(
      this.props.componentname
    )?.modelsArray;
    const modelsArrayTransformed = modelsArrayRaw.map((v) => ({
      label: v,
      value: v
    }));
    return modelsArrayTransformed;
  }

  getGroupedMixinOptions = () => {
    const mixinElements = document.querySelectorAll('a-mixin');
    const groupedArray = [];
    let categoryName, mixinId;

    const groupedObject = {};
    for (let mixinEl of Array.from(mixinElements)) {
      categoryName = mixinEl.getAttribute('category');
      if (!categoryName) continue;
      mixinId = mixinEl.id;
      if (!groupedObject[categoryName]) {
        groupedObject[categoryName] = [];
      }
      groupedObject[categoryName].push({ label: mixinId, value: mixinId });
    }

    for (let categoryName of Object.keys(groupedObject)) {
      groupedArray.push({
        label: categoryName,
        options: groupedObject[categoryName]
      });
    }
    return groupedArray;
  };

  updateModels = (value) => {
    const entity = this.props.entity;
    this.setState({ modelsArrayWidget: value });
    const modelsArrayForSaving = value.map((v) => v.value);
    const entityUpdateCommand = {
      entity: entity,
      component: this.props.componentname, // such as 'street-generated-clones__1'
      property: 'modelsArray',
      value: modelsArrayForSaving
    };
    AFRAME.INSPECTOR.execute('entityupdate', entityUpdateCommand);
  };

  render() {
    const groupStyles = {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    };

    const formatGroupLabel = (data) => (
      <div style={groupStyles}>
        <span>{data.label}</span>
      </div>
    );

    const handleHeaderClick = (id) => {
      const node = document.querySelector(`#${id}`).parentElement
        .nextElementSibling;
      const classes = node.classList;
      if (classes.contains('collapsed')) {
        node.classList.remove('collapsed');
      } else {
        node.classList.add('collapsed');
      }
    };

    const CustomGroupHeading = (props) => {
      return (
        <div
          className="group-heading-wrapper"
          onClick={() => handleHeaderClick(props.id)}
        >
          <components.GroupHeading className="collapsed" {...props} />
        </div>
      );
    };

    return (
      <div className="mixinOptions">
        <div className="propertyRow">
          <span className="text">Model</span>
          <span className="mixinValue">
            <Select
              id="mixinSelect"
              classNamePrefix="select-single"
              options={this.getGroupedMixinOptions()}
              components={{
                GroupHeading: CustomGroupHeading,
                DropdownIndicator: DropdownArrowIcon,
                IndicatorSeparator: () => null
              }}
              formatGroupLabel={formatGroupLabel}
              isMulti={true}
              isSearchable={true}
              isClearable={false}
              placeholder="Search mixins..."
              noResultsText="No mixins found"
              onChange={this.updateModels.bind(this)}
              simpleValue
              value={this.state.modelsArrayWidget}
            />
          </span>
        </div>
      </div>
    );
  }
}
