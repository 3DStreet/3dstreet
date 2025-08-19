import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import '../../style/AppMenu.scss';
import useStore from '@/store';
import { makeScreenshot } from '@/editor/lib/SceneUtils';
import posthog from 'posthog-js';
import Events from '../../lib/Events.js';
import canvasRecorder from '../../lib/CanvasRecorder';
import { useAuthContext } from '@/editor/contexts';
import {
  faCheck,
  faCircle,
  faChevronDown,
  faChevronRight
} from '@fortawesome/free-solid-svg-icons';
import { AwesomeIcon } from '../elements/AwesomeIcon';
import { useState, useEffect } from 'react';
import { currentOrthoDir } from '../../lib/cameras.js';

const cameraOptions = [
  {
    value: 'perspective',
    event: 'cameraperspectivetoggle',
    payload: null,
    label: '3D View',
    shortcut: '1'
  },
  {
    value: 'orthotop',
    event: 'cameraorthographictoggle',
    payload: 'top',
    label: 'Plan View',
    shortcut: '4'
  }
];

const AppMenu = ({ currentUser }) => {
  const {
    setModal,
    isInspectorEnabled,
    setIsInspectorEnabled,
    isGridVisible,
    setIsGridVisible,
    saveScene,
    startCheckout
  } = useStore();
  const { currentUser: authUser } = useAuthContext();
  const [currentCamera, setCurrentCamera] = useState('perspective');

  // Function to get current camera state from the actual camera system
  const getCurrentCameraState = () => {
    if (!AFRAME.INSPECTOR?.camera) return 'perspective';

    const camera = AFRAME.INSPECTOR.camera;
    if (camera.type === 'PerspectiveCamera') {
      return 'perspective';
    } else if (camera.type === 'OrthographicCamera') {
      return `ortho${currentOrthoDir}`;
    }
    return 'perspective';
  };

  useEffect(() => {
    // Initialize with actual camera state
    setCurrentCamera(getCurrentCameraState());

    const handleCameraToggle = (event) => {
      setCurrentCamera(event.value);
    };

    // Also sync when inspector is enabled/disabled
    const handleInspectorToggle = () => {
      // Small delay to ensure camera system has updated
      setTimeout(() => {
        setCurrentCamera(getCurrentCameraState());
      }, 100);
    };

    Events.on('cameratoggle', handleCameraToggle);
    Events.on('inspectortoggle', handleInspectorToggle);

    return () => {
      Events.off('cameratoggle', handleCameraToggle);
      Events.off('inspectortoggle', handleInspectorToggle);
    };
  }, []);

  const handleCameraChange = (option) => {
    // Let the camera system handle the camera change first
    Events.emit(option.event, option.payload);
    // The cameratoggle event will be emitted by the camera system with the proper camera object
  };

  const newHandler = () => {
    posthog.capture('new_scene_clicked');
    setModal('new');
  };

  const showAIChatPanel = () => {
    // Use the global ref to access the AIChatPanel component
    if (
      window.aiChatPanelRef &&
      typeof window.aiChatPanelRef.openPanel === 'function'
    ) {
      window.aiChatPanelRef.openPanel();
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="DropdownTrigger">
        <img
          src="/ui_assets/3D-St-stacked-128.png"
          alt="3DStreet Logo"
          className="logo-image"
        />
        <AwesomeIcon
          icon={faChevronDown}
          size={12}
          className="dropdown-arrow"
        />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="DropdownContent"
          align="start"
          sideOffset={5}
        >
          {/* File Submenu */}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="DropdownSubTrigger">
              File
              <div className="RightSlot">
                <AwesomeIcon icon={faChevronRight} size={12} />
              </div>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="DropdownSubContent">
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={newHandler}
                >
                  New...
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => setModal('scenes')}
                >
                  Open...
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="DropdownSeparator" />
                <DropdownMenu.Item
                  className="DropdownItem"
                  disabled={!STREET.utils.getCurrentSceneId()}
                  onClick={() => {
                    if (!currentUser) {
                      setModal('signin');
                      return;
                    }
                    if (currentUser?.uid !== STREET.utils.getAuthorId()) {
                      return;
                    }
                    saveScene(false);
                  }}
                >
                  Save
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => {
                    if (!currentUser) {
                      setModal('signin');
                      return;
                    }
                    saveScene(true, true);
                  }}
                >
                  Save As...
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="DropdownSeparator" />
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => {
                    makeScreenshot();
                    setModal('screenshot');
                  }}
                >
                  Share & Download...
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          {/* View Submenu */}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="DropdownSubTrigger">
              View
              <div className="RightSlot">
                <AwesomeIcon icon={faChevronRight} size={12} />
              </div>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="DropdownSubContent">
                <DropdownMenu.CheckboxItem
                  className="DropdownCheckboxItem"
                  checked={isGridVisible}
                  onCheckedChange={setIsGridVisible}
                >
                  <DropdownMenu.ItemIndicator className="DropdownItemIndicator">
                    <AwesomeIcon icon={faCheck} size={14} />
                  </DropdownMenu.ItemIndicator>
                  Show Grid
                  <div className="RightSlot">G</div>
                </DropdownMenu.CheckboxItem>
                <DropdownMenu.Separator className="DropdownSeparator" />
                {cameraOptions.map((option) => (
                  <DropdownMenu.CheckboxItem
                    key={option.value}
                    className="DropdownCheckboxItem"
                    checked={currentCamera === option.value}
                    onCheckedChange={() => handleCameraChange(option)}
                  >
                    <DropdownMenu.ItemIndicator className="DropdownItemIndicator">
                      <AwesomeIcon icon={faCircle} size={8} />
                    </DropdownMenu.ItemIndicator>
                    {option.label}
                    <div className="RightSlot">{option.shortcut}</div>
                  </DropdownMenu.CheckboxItem>
                ))}
                <DropdownMenu.Separator className="DropdownSeparator" />
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => AFRAME.INSPECTOR.controls.resetZoom()}
                >
                  Reset Camera View
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          {/* Run Submenu */}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="DropdownSubTrigger">
              Run
              <div className="RightSlot">
                <AwesomeIcon icon={faChevronRight} size={12} />
              </div>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="DropdownSubContent">
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() => {
                    setIsInspectorEnabled(!isInspectorEnabled);
                  }}
                >
                  Start Viewer
                  <div className="RightSlot">5</div>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={async () => {
                    if (!authUser) {
                      setModal('signin');
                      return;
                    }

                    if (!authUser.isPro) {
                      startCheckout(null);
                      posthog.capture('recording_feature_paywall_shown');
                      return;
                    }

                    const aframeCanvas =
                      document.querySelector('a-scene').canvas;
                    if (!aframeCanvas) {
                      console.error(
                        'Could not find A-Frame canvas for recording'
                      );
                      return;
                    }

                    const success = await canvasRecorder.startRecording(
                      aframeCanvas,
                      {
                        name:
                          '3DStreet-Recording-' +
                          new Date().toISOString().slice(0, 10)
                      }
                    );

                    if (success) {
                      setIsInspectorEnabled(!isInspectorEnabled);
                    }
                  }}
                >
                  Start and Record{' '}
                  <div className="RightSlot">
                    <span className="pro-badge">Pro</span>
                  </div>
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>

          {/* Help Submenu */}
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="DropdownSubTrigger">
              Help
              <div className="RightSlot">
                <AwesomeIcon icon={faChevronRight} size={12} />
              </div>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="DropdownSubContent">
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() =>
                    window.open('https://www.3dstreet.org/docs/', '_blank')
                  }
                >
                  Documentation
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() =>
                    window.open(
                      'https://www.3dstreet.org/docs/3dstreet-editor/keyboard-shortcuts',
                      '_blank'
                    )
                  }
                >
                  Keyboard Shortcuts
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={() =>
                    window.open(
                      'https://www.3dstreet.org/docs/3dstreet-editor/mouse-and-touch-controls',
                      '_blank'
                    )
                  }
                >
                  Mouse and Touch Controls
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="DropdownSeparator" />
                <DropdownMenu.Item
                  className="DropdownItem"
                  onClick={showAIChatPanel}
                >
                  AI Scene Assistant
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

export default AppMenu;
