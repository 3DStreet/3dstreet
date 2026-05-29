import React from 'react';
import Events from '../../lib/Events';
import EntityLabel from '../scenegraph/EntityLabel';

export default class ViewportHUD extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hoveredEntity: null
    };
  }

  onRaycasterMouseEnter = (el) => {
    this.setState({ hoveredEntity: el });
  };

  onRaycasterMouseLeave = (el) => {
    this.setState({ hoveredEntity: el });
  };

  componentDidMount() {
    Events.on('raycastermouseenter', this.onRaycasterMouseEnter);
    Events.on('raycastermouseleave', this.onRaycasterMouseLeave);
  }

  componentWillUnmount() {
    Events.off('raycastermouseenter', this.onRaycasterMouseEnter);
    Events.off('raycastermouseleave', this.onRaycasterMouseLeave);
  }

  render() {
    return (
      <div id="viewportHud">
        <p>
          <EntityLabel entity={this.state.hoveredEntity} />
        </p>
      </div>
    );
  }
}
