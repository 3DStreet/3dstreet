import CommonComponents from './CommonComponents';
import AdvancedComponents from './AdvancedComponents';
import FeaturedComponents from './FeaturedComponents';
import PropTypes from 'prop-types';
import React from 'react';
import Events from '../../lib/Events';
import MixinMetadata from './MixinMetadata';
import AddGeneratorComponent from './AddGeneratorComponent';

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

  // Entities that can meaningfully contribute a terrain-flattening volume
  // (#1476): anything with renderable content the user placed themselves.
  canFlattenTerrain = () => {
    const { entity } = this.props;
    return !!(
      entity.components &&
      (entity.components.geometry ||
        entity.components['gltf-model'] ||
        entity.mixinEls?.length)
    );
  };

  // Approved add-on components for generic objects, mirroring the segment
  // panel's Add Generator Component dropdown. Singleton behavior (an option
  // disappears once present) is enforced by AddGeneratorComponent.
  getApprovedComponents = () => {
    const { entity } = this.props;
    const approved = [];
    // Grass scatters over the host's own geometry primitive.
    if (entity.components?.geometry) {
      approved.push({ value: 'street-generated-grass', label: 'Grass' });
    }
    if (this.canFlattenTerrain()) {
      approved.push({
        value: 'geo-flatten',
        label: 'Flatten Terrain',
        // Primitives raycast cheaply against their own mesh (and keep the
        // legacy flatten-onto-the-box semantics); models get a footprint
        // proxy plane instead of per-triangle raycasts against the model.
        attrValue: entity.components?.geometry ? 'mode: mesh' : 'mode: auto'
      });
    }
    return approved;
  };

  render() {
    const { entity } = this.props;
    // A shape's featured section (direction, curve style, fill/line) is the
    // main thing being edited, so it leads and the transform rows follow;
    // everything else keeps transform first.
    const featuredFirst = !!entity.getAttribute('shape');
    const featured = <FeaturedComponents entity={entity} />;

    return (
      <div className="components">
        {featuredFirst && featured}
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
        {!featuredFirst && featured}
        {this.getApprovedComponents().length > 0 && (
          <AddGeneratorComponent
            entity={entity}
            components={this.getApprovedComponents()}
          />
        )}
        <div className="advancedComponentsContainer">
          <AdvancedComponents entity={entity} />
        </div>
      </div>
    );
  }
}
