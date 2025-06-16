import CommonComponents from './CommonComponents';
import AdvancedComponents from './AdvancedComponents';
import PropTypes from 'prop-types';
import React from 'react';
import Events from '../../lib/Events';
import MixinMetadata from './MixinMetadata';

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
        {entity.hasAttribute('data-no-transform') ? (
          <div className="sidepanelContent">
            <br />
            <p>⚠️ Transformations disabled for this layer.</p>
          </div>
        ) : (
          <div className="sidepanelContent">
            <CommonComponents entity={entity} />
          </div>
        )}
        {!!entity.mixinEls.length && (
          <div className="details">
            <MixinMetadata entity={entity} />
          </div>
        )}
        {entity.classList.contains('flattening') && (
          <div className="details">
            <div className="propertyRow" style={{ paddingRight: '10px' }}>
              <div className="rounded bg-blue-50 p-2 text-gray-600">
                <div className="mb-1 font-semibold uppercase">
                  💡 Flattening Shape Tips
                </div>
                <ul className="space-y-1">
                  <li>• This shape defines terrain flattening area</li>
                  <li>
                    • Position this flattening shape below target area to make
                    room for your design
                  </li>
                  <li>• Hide visibility by unchecking in Layers panel</li>
                  <li>
                    • Enable flattening in Geospatial sidebar and choose this
                    shape to flatten
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
        <div className="advancedComponentsContainer">
          <AdvancedComponents entity={entity} />
        </div>
      </div>
    );
  }
}
