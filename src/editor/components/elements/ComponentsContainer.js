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
        {(() => {
          const uploadStatus = entity.getAttribute('data-upload-status');
          if (uploadStatus) {
            let message;
            let bgColor = 'bg-yellow-50';
            let textColor = 'text-yellow-700';
            let title = 'Upload Status';

            switch (uploadStatus) {
              case 'uploading':
                title = '⏳ Uploading Model...';
                message =
                  'Your model is being uploaded to the cloud. This may take a moment.';
                bgColor = 'bg-blue-50';
                textColor = 'text-green-600';
                break;
              case 'success':
                title = '✅ Upload Successful';
                message =
                  'Your model has been saved to the cloud and will be part of this scene.';
                bgColor = 'bg-green-50';
                textColor = 'text-green-600';
                break;
              case 'failed':
                title = '❌ Upload Failed';
                message =
                  'There was an error uploading your model. It will be treated as a temporary file.';
                bgColor = 'bg-red-50';
                textColor = 'text-red-500';
                break;
              case 'pro-required':
                title = '⚠️ Pro Feature';
                message = (
                  <>
                    This model is temporary. To save it permanently, please
                    upgrade to a Pro plan.{' '}
                    <a
                      href="/pro"
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'underline' }}
                    >
                      Learn more about Pro features.
                    </a>
                  </>
                );
                break;
              default:
                return null;
            }

            return (
              <div className="details">
                <div className="propertyRow" style={{ paddingRight: '10px' }}>
                  <div className={`rounded ${bgColor} p-2 ${textColor}`}>
                    <div className="mb-1 font-semibold uppercase">{title}</div>
                    <p>{message}</p>
                  </div>
                </div>
              </div>
            );
          } else if (entity.hasAttribute('data-temporary-file')) {
            return (
              <div className="details">
                <div className="propertyRow" style={{ paddingRight: '10px' }}>
                  <div className="rounded bg-yellow-50 p-2 text-yellow-700">
                    <div className="mb-1 font-semibold uppercase">
                      ⚠️ Temporary Model
                    </div>
                    <p>
                      This drag-and-drop model is only available during this
                      session and will not be saved when you reload the scene.{' '}
                      <a
                        href="https://www.3dstreet.com/blog/2025/02/06/creating-custom-models-with-ai-for-creative-street-scenes/#4-optimize-for-web-use"
                        target="_blank"
                        rel="noreferrer"
                        style={{ textDecoration: 'underline' }}
                      >
                        See instructions for saving imported glTF files.
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })()}
        <div className="advancedComponentsContainer">
          <AdvancedComponents entity={entity} />
        </div>
      </div>
    );
  }
}
