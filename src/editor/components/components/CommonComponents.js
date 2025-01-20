import React from 'react';
import PropTypes from 'prop-types';
import DEFAULT_COMPONENTS from './DefaultComponents';
import PropertyRow from './PropertyRow';
import { getEntityClipboardRepresentation } from '../../lib/entity';
import Events from '../../lib/Events';
import Clipboard from 'clipboard';
import { saveBlob } from '../../lib/utils';
import CustomizeColorWidget from './CustomizeColorWidget';

export default class CommonComponents extends React.Component {
  static propTypes = {
    entity: PropTypes.object
  };

  onEntityUpdate = (detail) => {
    if (detail.entity !== this.props.entity) {
      return;
    }
    if (
      DEFAULT_COMPONENTS.indexOf(detail.component) !== -1 ||
      detail.component === 'id' ||
      detail.component === 'class' ||
      detail.component === 'mixin'
    ) {
      this.forceUpdate();
    }
  };

  componentDidMount() {
    Events.on('entityupdate', this.onEntityUpdate);

    var clipboard = new Clipboard('[data-action="copy-entity-to-clipboard"]', {
      text: (trigger) => {
        return getEntityClipboardRepresentation(this.props.entity);
      }
    });
    clipboard.on('error', (e) => {
      // @todo Show the error on the UI
    });
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
  }

  renderCommonAttributes() {
    const entity = this.props.entity;
    // return ['position', 'rotation', 'scale', 'visible']
    const rows = ['position', 'rotation', 'scale'].map((componentName) => {
      // if entity has managed-street component, then don't show scale
      if (componentName === 'scale' && entity.components['managed-street']) {
        return null;
      }
      const schema = AFRAME.components[componentName].schema;
      var data = entity.object3D[componentName];
      if (componentName === 'rotation') {
        data = {
          x: THREE.MathUtils.radToDeg(entity.object3D.rotation.x),
          y: THREE.MathUtils.radToDeg(entity.object3D.rotation.y),
          z: THREE.MathUtils.radToDeg(entity.object3D.rotation.z)
        };
      }
      return (
        <PropertyRow
          key={componentName}
          name={componentName}
          schema={schema}
          data={data}
          isSingle={true}
          componentname={componentName}
          entity={entity}
        />
      );
    });

    // Custom colors are only applicable to entities, not things like intersections or groups.
    if (entity.hasAttribute('mixin')) {
      rows.push(<CustomizeColorWidget entity={entity} key={entity.id} />);
    }
    return rows;
  }

  exportToGLTF() {
    const entity = this.props.entity;
    AFRAME.INSPECTOR.exporters.gltf.parse(
      entity.object3D,
      function (buffer) {
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        saveBlob(blob, (entity.id || 'entity') + '.glb');
      },
      function (error) {
        console.error(error);
      },
      { binary: true }
    );
  }

  render() {
    const entity = this.props.entity;
    if (!entity) {
      return <div />;
    }

    return (
      <div className="collapsible-content">{this.renderCommonAttributes()}</div>
    );
  }
}
