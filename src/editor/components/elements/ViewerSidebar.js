import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import { useAuthContext } from '@/editor/contexts';
import PropertyRow from './PropertyRow';
import AdvancedComponents from './AdvancedComponents';
import { Copy32Icon } from '@/editor/icons';
import { Button } from '../elements';
import useStore from '@/store';
import Events from '../../lib/Events';
import canvasRecorder from '../../lib/CanvasRecorder';
import { shouldShowProperty } from '@/editor/components/elements/Component';
import { QrCode } from './QrCode';

const ViewerSidebar = ({ entity }) => {
  const componentName = 'viewer-mode';
  // Access the store to control inspector mode and get recording status
  const { setIsInspectorEnabled, isRecording, setIsRecording } = useStore();
  // Get current user from auth context
  const { currentUser } = useAuthContext();
  // Use state to force re-renders
  const [, forceUpdate] = useState({});

  // Set up event listener to detect component changes
  useEffect(() => {
    if (!entity) return;

    const handleEntityUpdate = (detail) => {
      if (detail.entity === entity && detail.component === componentName) {
        // Force a re-render when the component changes
        forceUpdate({});
      }
    };

    // Subscribe to entity update events
    Events.on('entityupdate', handleEntityUpdate);

    // Clean up when component unmounts
    return () => {
      Events.off('entityupdate', handleEntityUpdate);
    };
  }, [entity]);

  // Handler for entering viewer mode
  const handleEnterViewerMode = () => {
    setIsInspectorEnabled(false);
  };

  // Handler for entering viewer mode with recording
  const handleStartRecording = async () => {
    // Check if user is logged in and has pro access
    if (!currentUser) {
      // Not logged in, show signin modal
      useStore.getState().setModal('signin');
      return;
    }

    if (!currentUser.isPro) {
      // User doesn't have pro access, show payment modal
      useStore.getState().startCheckout(null); // No redirect after payment
      return;
    }

    // Find the A-Frame canvas
    const aframeCanvas = document.querySelector('a-scene').canvas;
    if (!aframeCanvas) {
      console.error('Could not find A-Frame canvas for recording');
      return;
    }

    // Start recording the canvas
    const success = await canvasRecorder.startRecording(aframeCanvas, {
      name: '3DStreet-Recording-' + new Date().toISOString().slice(0, 10)
    });

    if (success) {
      setIsRecording(true);
      // Enter viewer mode
      setIsInspectorEnabled(false);
    }
  };

  // Handler for stopping recording manually
  const handleStopRecording = async () => {
    if (canvasRecorder.isCurrentlyRecording()) {
      try {
        console.log('Manually stopping recording...');
        await canvasRecorder.stopRecording();
        setIsRecording(false);
      } catch (error) {
        console.error('Error stopping recording:', error);
      }
    }
  };

  // Initialize recording status check on component mount
  useEffect(() => {
    // Start the recording status check
    useStore.getState().startRecordingCheck();

    // Clean up when component unmounts
    return () => {
      useStore.getState().stopRecordingCheck();
    };
  }, []);

  // Check if entity and its components exist
  const component = entity?.components?.[componentName];

  // Function to get current scene ID
  const getCurrentSceneId = () => {
    if (
      window.STREET &&
      window.STREET.utils &&
      window.STREET.utils.getCurrentSceneId
    ) {
      return window.STREET.utils.getCurrentSceneId();
    }
    return null;
  };

  // Generate viewer URL for AR-WebXR mode
  const getViewerUrl = () => {
    const sceneId = getCurrentSceneId();
    if (!sceneId) return '';

    // Get the base URL (without hash)
    const baseUrl = window.location.origin;
    // Check if webXRVariant is enabled AND user has Pro access
    const isVariantEnabled =
      currentUser?.isPro && component?.data?.webXRVariant === true;
    // Create the viewer URL with the scene ID in the hash
    // Include /webxr-variant/ path if the variant is enabled
    const pathPrefix = isVariantEnabled ? 'webxr-variant/' : '';
    return `${baseUrl}/${pathPrefix}?viewer=true#/scenes/${sceneId}`;
  };

  // Check if AR-WebXR mode is selected
  const isArWebXRMode = component?.data?.preset === 'ar-webxr';

  // Helper function to get all measure line entities in the scene
  const getMeasureLineEntities = () => {
    const entities = Array.from(document.querySelectorAll('[measure-line]'));
    return entities.map((entity) => ({
      id: entity.id || `measure-line-${entities.indexOf(entity)}`,
      name:
        entity.getAttribute('data-layer-name') ||
        entity.id ||
        `Measure Line ${entities.indexOf(entity) + 1}`
    }));
  };

  // Check if measure-line camera path is selected
  const isMeasureLinePath =
    component?.data?.preset === 'camera-path' &&
    component?.data?.cameraPath === 'measure-line';

  return (
    <div className="viewer-sidebar">
      <div className="viewer-controls">
        <div className="details">
          {component && component.schema && component.data && (
            <>
              <PropertyRow
                key="preset"
                name="preset"
                label="Mode"
                schema={component.schema['preset']}
                data={component.data['preset']}
                componentname={componentName}
                isSingle={false}
                entity={entity}
              />
              {/* Use the shouldShowProperty function to determine if cameraPath should be shown */}
              {shouldShowProperty('cameraPath', component) && (
                <PropertyRow
                  key="cameraPath"
                  name="cameraPath"
                  label="Camera Path Style"
                  schema={component.schema['cameraPath']}
                  data={component.data['cameraPath']}
                  componentname={componentName}
                  isSingle={false}
                  entity={entity}
                />
              )}
              {/* Show measure line selector when measure-line camera path is selected */}
              {isMeasureLinePath && (
                <MeasureLineSelector
                  entity={entity}
                  componentName={componentName}
                  measureLineEntities={getMeasureLineEntities()}
                  currentValue={component.data.measureLineEntity}
                />
              )}
              {/* Show webXRVariant option when ar-webxr is selected */}
              {shouldShowProperty('webXRVariant', component) && (
                <>
                  <div className="propertyRow">
                    <div className="fakePropertyRowLabel">Android</div>
                    <div className="fakePropertyRowValue">
                      <span className="checkmark-green">✓</span>
                      <span className="ml-2">via WebXR</span>
                    </div>
                  </div>
                  {currentUser?.isPro ? (
                    <PropertyRow
                      key="webXRVariant"
                      name="webXRVariant"
                      label="iOS"
                      schema={component.schema['webXRVariant']}
                      data={component.data['webXRVariant']}
                      componentname={componentName}
                      isSingle={false}
                      entity={entity}
                      rightElement={
                        <>
                          via Variant Launch{' '}
                          <span className="pro-badge">Pro</span>
                        </>
                      }
                    />
                  ) : (
                    <div
                      className="propertyRow"
                      onClick={() => useStore.getState().startCheckout(null)}
                    >
                      <div className="fakePropertyRowLabel">iOS</div>
                      <div className="fakePropertyRowValue">
                        <div className="checkboxAnim">
                          <input
                            type="checkbox"
                            checked={false}
                            value={false}
                          />
                          <label />
                        </div>
                        <span className="ml-2">
                          via Variant Launch{' '}
                          <span className="pro-badge">Pro</span>
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {!isArWebXRMode && (
            <>
              <br />
              <div className="propertyRow">
                <Button
                  variant="toolbtn"
                  onClick={handleEnterViewerMode}
                  className="mb-2 w-full"
                  disabled={isRecording}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="mr-2 inline-block"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Start Viewer Mode
                </Button>
              </div>
              <div className="propertyRow">
                <Button
                  variant="toolbtn"
                  onClick={handleStartRecording}
                  className="mb-4 w-full"
                  disabled={isRecording}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="mr-2 inline-block text-red-500"
                  >
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                  Start and Record <span className="pro-badge">Pro</span>
                </Button>
                {isRecording && (
                  <>
                    <div className="mb-2 mt-1 text-center text-sm font-bold text-red-500">
                      Recording in progress...
                    </div>
                    <Button
                      variant="toolbtn"
                      onClick={handleStopRecording}
                      className="mb-4 w-full"
                    >
                      Stop Recording & Save
                    </Button>
                  </>
                )}
              </div>
            </>
          )}

          {/* Display viewer URL when AR-WebXR mode is selected */}
          {isArWebXRMode &&
            (getCurrentSceneId() ? (
              <>
                <div className="propertyRow">
                  <div className="fakePropertyRowLabel">AR URL</div>
                  <URLValueWithCopy url={getViewerUrl()} />
                </div>
                <div className="propertyRow">
                  <div className="fakePropertyRowLabel">AR QR</div>
                  <div className="fakePropertyRowValue">
                    <QrCode url={getViewerUrl()} />
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded bg-yellow-50 p-2 text-sm text-yellow-700">
                Please log in and save your scene to generate a shareable AR
                viewer URL.
              </div>
            ))}

          {entity && entity.components && (
            <div className="propertyRow">
              <AdvancedComponents entity={entity} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

ViewerSidebar.propTypes = {
  entity: PropTypes.object.isRequired
};

// Helper component for the copy button
const CopyButton = ({ textContent, copied, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`copy-button ${copied ? 'copied' : ''}`}
    >
      <Copy32Icon />
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
};

// Component for URL value with copy functionality
const URLValueWithCopy = ({ url }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // Keep the button visible while showing "Copied!"
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div
      className="fakePropertyRowValue input-style"
      onClick={handleCopy}
      style={{ cursor: 'pointer' }}
    >
      {url}
      <CopyButton textContent={url} copied={copied} onClick={handleCopy} />
    </div>
  );
};

// Component for selecting measure line entities
const MeasureLineSelector = ({
  entity,
  componentName,
  measureLineEntities,
  currentValue
}) => {
  const handleMeasureLineChange = (event) => {
    const value = event.target.value;
    if (entity.setAttribute) {
      entity.setAttribute(componentName, { measureLineEntity: value });
    }
  };

  const handleCreateMeasureLine = () => {
    // Switch to ruler tool to create a new measure line
    if (window.AFRAME && window.AFRAME.INSPECTOR) {
      // Get the action bar component and trigger ruler tool
      const actionBarElement = document.querySelector('[action-bar]');
      if (actionBarElement) {
        // This would need to be implemented - switching to ruler mode
        console.log('Switch to ruler tool to create measure line');
      }
    }
  };

  return (
    <div className="propertyRow">
      <div className="fakePropertyRowLabel">Camera Path Line</div>
      <div className="fakePropertyRowValue">
        {measureLineEntities.length > 0 ? (
          <select
            value={currentValue || ''}
            onChange={handleMeasureLineChange}
            className="input-style"
            style={{ width: '100%' }}
          >
            <option value="">Select a measure line...</option>
            {measureLineEntities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-center">
            <div className="mb-2 text-sm text-gray-600">
              No measure lines found in scene
            </div>
            <Button
              variant="toolbtn"
              onClick={handleCreateMeasureLine}
              className="w-full"
            >
              Create Measure Line
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ViewerSidebar;
