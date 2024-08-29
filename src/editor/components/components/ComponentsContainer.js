import CommonComponents from './CommonComponents';
import AdvancedComponents from './AdvancedComponents';
import PropTypes from 'prop-types';
import React from 'react';
import Events from '../../lib/Events';

export default class ComponentsContainer extends React.Component {
  static propTypes = {
    entity: PropTypes.object
  };

  onEntityUpdate = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    if (detail.component === 'mixin') {
      this.forceUpdate();
    }
  };

  componentDidMount() {
    Events.on('entityupdate', this.onEntityUpdate);
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
  }

  render() {
    const { entity } = this.props;

    return (
      <div className="components">
        <CommonComponents entity={entity} />
        <AdvancedComponents entity={entity} />
      </div>
    );
  }
}
