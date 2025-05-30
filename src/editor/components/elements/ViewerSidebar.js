import PropTypes from 'prop-types';
import { useState, useEffect } from 'react';
import { useAuthContext } from '@/editor/contexts';
import PropertyRow from './PropertyRow';
import AdvancedComponents from './AdvancedComponents';
import { Button } from '../elements';
import useStore from '@/store';
import Events from '../../lib/Events';
import posthog from 'posthog-js';
import canvasRecorder from '../../lib/CanvasRecorder';

// Helper function to determine if a property should be shown based on schema conditions
function shouldShowProperty(propertyName, component) {
  if (!component.schema[propertyName].if) {
    return true;
  }

  let showProperty = true;
  for (const [conditionKey, conditionValue] of Object.entries(
    component.schema[propertyName].if
  )) {
    if (Array.isArray(conditionValue)) {
      if (conditionValue.indexOf(component.data[conditionKey]) === -1) {
        showProperty = false;
        break;
      }
    } else {
      if (conditionValue !== component.data[conditionKey]) {
        showProperty = false;
        break;
      }
    }
  }
  return showProperty;
}

const ViewerSidebar = ({ entity }) => {
  const componentName = 'viewer-mode';
  // Access the store to control inspector mode
  const { setIsInspectorEnabled } = useStore();
  // Get current user from auth context
  const { currentUser } = useAuthContext();
  // Track recording state to update UI
  const [isRecording, setIsRecording] = useState(false);
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
    posthog.capture('enter_viewer_mode_clicked_from_sidebar');
    setIsInspectorEnabled(false);
  };

  // Handler for entering viewer mode with recording
  const handleStartRecording = async () => {
    posthog.capture('start_recording_clicked_from_sidebar');

    // Check if user is logged in and has pro access
    if (!currentUser) {
      // Not logged in, show signin modal
      useStore.getState().setModal('signin');
      return;
    }

    if (!currentUser.isPro) {
      // User doesn't have pro access, show payment modal
      useStore.getState().startCheckout(null); // No redirect after payment
      posthog.capture('recording_feature_paywall_shown');
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
    posthog.capture('stop_recording_clicked_from_sidebar');

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

  // Check recording status on each render
  useEffect(() => {
    const checkRecordingStatus = () => {
      const recordingStatus = canvasRecorder.isCurrentlyRecording();
      if (isRecording !== recordingStatus) {
        setIsRecording(recordingStatus);
      }
    };

    // Check immediately and then set up interval
    checkRecordingStatus();
    const intervalId = setInterval(checkRecordingStatus, 1000);

    return () => clearInterval(intervalId);
  }, [isRecording]);

  // Check if entity and its components exist
  const component = entity?.components?.[componentName];

  return (
    <div className="viewer-sidebar">
      <div className="viewer-controls">
        <div className="details">
          <div className="propertyRow">
            <Button
              variant="toolbtn"
              onClick={handleEnterViewerMode}
              className="mb-2 w-full"
              disabled={isRecording}
            >
              Start in Viewer Mode
            </Button>
          </div>
          <div className="propertyRow">
            <Button
              variant="toolbtn"
              onClick={handleStartRecording}
              className="mb-4 w-full"
              disabled={isRecording}
            >
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
          {component && component.schema && component.data && (
            <>
              <PropertyRow
                key="preset"
                name="preset"
                label="Viewing Mode"
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
            </>
          )}
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

export default ViewerSidebar;
