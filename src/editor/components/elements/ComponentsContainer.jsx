import CommonComponents from './CommonComponents';
import FeaturedComponents from './FeaturedComponents';
import PropTypes from 'prop-types';
import React from 'react';
import { FormattedMessage } from 'react-intl';
import Events from '../../lib/Events';
import MixinMetadata from './MixinMetadata';
import PanelFooter from './PanelFooter';

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
    // Any visible object can become a clickable viewer hotspot — a
    // semitransparent block, an uploaded model, a splat placeholder.
    approved.push({
      value: 'focus-hotspot',
      label: 'Focus Hotspot',
      attrValue: ''
    });
    // A closed shape can become a surface visitors build on while playing
    // (Visitor Build, docs/visitor-build.md).
    if (entity.components?.shape?.data?.closed) {
      approved.push({
        value: 'build-area',
        label: 'Build Area',
        attrValue: ''
      });
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
    // A shape reads Shape (ShapeSidebar, above this container), Style (the
    // shape component's fill/line section), Transform, then its roles — Build
    // Area, Flatten Terrain (#2069). Everything else keeps transform first.
    const isShape = !!entity.getAttribute('shape');

    return (
      <div className="components">
        {isShape && <FeaturedComponents entity={entity} only={['shape']} />}
        {entity.hasAttribute('data-no-transform') ? (
          <div className="sidepanelContent">
            <br />
            <p>
              <FormattedMessage
                id="componentsContainer.transformsDisabled"
                defaultMessage="⚠️ Transformations disabled for this layer."
              />
            </p>
          </div>
        ) : (
          <CommonComponents entity={entity} />
        )}
        {!!entity.mixinEls.length && (
          <div className="details">
            <MixinMetadata entity={entity} />
          </div>
        )}
        <FeaturedComponents
          entity={entity}
          exclude={isShape ? ['shape'] : undefined}
        />
        <PanelFooter
          entity={entity}
          addComponents={this.getApprovedComponents()}
        />
      </div>
    );
  }
}
