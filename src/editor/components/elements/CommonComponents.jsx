import React from 'react';
import PropTypes from 'prop-types';
import { FormattedMessage } from 'react-intl';
import Collapsible from '../Collapsible';
import DEFAULT_COMPONENTS from './DefaultComponents';
import PropertyRow from './PropertyRow';
import PositionRow from './PositionRow';
import Events from '../../lib/Events';
import { saveBlob } from '../../lib/utils';
import { expandBatchedMeshesForExport } from '../../../batch-models';

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
  }

  componentWillUnmount() {
    Events.off('entityupdate', this.onEntityUpdate);
  }

  renderCommonAttributes() {
    const entity = this.props.entity;
    return ['position', 'rotation', 'scale'].map((componentName) => {
      // Anything that opts out of scaling (managed streets, shapes) hides the
      // row: the command layer refuses the write anyway, so showing it would
      // only offer an edit that bounces back.
      if (
        componentName === 'scale' &&
        entity.hasAttribute('data-transform-no-scale')
      ) {
        return null;
      }
      if (componentName === 'position') {
        // Position or the read-only geolocated readout — the label toggles
        // between them on geospatial scenes (#1979).
        return <PositionRow key={componentName} entity={entity} />;
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
  }

  exportToGLTF() {
    const entity = this.props.entity;
    // A batched entity's own mesh was stripped into a scene-level BatchedMesh; expansion
    // rebuilds temporary meshes under the entity so the export isn't empty.
    // restore() must run in BOTH exporter callbacks.
    const restoreExportScene = expandBatchedMeshesForExport(entity.object3D);
    AFRAME.INSPECTOR.exporters.gltf.parse(
      entity.object3D,
      function (buffer) {
        restoreExportScene();
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        saveBlob(blob, (entity.id || 'entity') + '.glb');
      },
      function (error) {
        restoreExportScene();
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

    // Transform is a named collapsible section like geometry/material (#1981)
    // — but not deletable. `sidepanelContent` stays on the rows wrapper so
    // the vec3 row styling keyed to it keeps applying.
    return (
      <Collapsible sectionKey="transform">
        <div className="componentHeader collapsible-header">
          <span className="componentTitle" title="Transform">
            <span>
              <FormattedMessage
                id="sidebar.transform"
                defaultMessage="Transform"
              />
            </span>
          </span>
        </div>
        <div className="collapsible-content sidepanelContent">
          {this.renderCommonAttributes()}
        </div>
      </Collapsible>
    );
  }
}
