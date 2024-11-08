import { HelpButton, GeoPanel, ZoomButtons } from './components';
import { useState, useEffect } from 'react';
import ComponentsSidebar from './components/Sidebar';
import Events from '../lib/Events';
import ModalTextures from './modals/ModalTextures';
import SceneGraph from './scenegraph/SceneGraph';
import { ScreenshotModal } from './modals/ScreenshotModal';
// import ViewportHUD from "./viewport/ViewportHUD";
import { SignInModal } from './modals/SignInModal';
import { ProfileModal } from './modals/ProfileModal';
import { firebaseConfig } from '../services/firebase.js';
import { LoadScript } from '@react-google-maps/api';
import { GeoModal } from './modals/GeoModal';
import { ActionBar } from './components/ActionBar';
import { ScenesModal } from './modals/ScenesModal';
import { PaymentModal } from './modals/PaymentModal';
import { SceneEditTitle } from './components/SceneEditTitle';
import { AddLayerPanel } from './components/AddLayerPanel';
import { IntroModal } from './modals/IntroModal';
import posthog from 'posthog-js';
import { ToolbarWrapper } from './scenegraph/ToolbarWrapper.js';

THREE.ImageUtils.crossOrigin = '';

// Define the libraries array as a constant outside of the component
const GOOGLE_MAPS_LIBRARIES = ['places'];

export default function Main() {
  const [state, setState] = useState({
    entity: null,
    inspectorEnabled: true,
    isModalTexturesOpen: false,
    sceneEl: AFRAME.scenes[0],
    visible: {
      scenegraph: true,
      attributes: true
    }
  });

  useEffect(() => {
    const htmlEditorButton = document?.querySelector(
      '.viewer-logo-start-editor-button'
    );
    htmlEditorButton && htmlEditorButton.remove();

    handleStreetMixURL();
    window.addEventListener('hashchange', () => handleStreetMixURL());
    Events.on('opentexturesmodal', function (selectedTexture, textureOnClose) {
      setState((prevState) => ({
        ...prevState,
        selectedTexture: selectedTexture,
        isModalTexturesOpen: true,
        textureOnClose: textureOnClose
      }));
    });
    Events.on('entityselect', (entity) => {
      setState((prevState) => ({
        ...prevState,
        entity: entity
      }));
    });
    Events.on('inspectortoggle', (enabled) => {
      posthog.capture('inspector_toggled', { enabled: enabled });
      setState((prevState) => ({
        ...prevState,
        inspectorEnabled: enabled
      }));
    });
    Events.on('togglesidebar', (event) => {
      if (event.which === 'all') {
        if (state.visible.scenegraph || state.visible.attributes) {
          setState((prevState) => ({
            ...prevState,
            visible: {
              scenegraph: false,
              attributes: false
            }
          }));
        } else {
          setState((prevState) => ({
            ...prevState,
            visible: {
              scenegraph: true,
              attributes: true
            }
          }));
        }
      } else if (event.which === 'attributes') {
        setState((prevState) => ({
          visible: {
            ...prevState.visible,
            attributes: !prevState.visible.attributes
          }
        }));
      } else if (event.which === 'scenegraph') {
        setState((prevState) => ({
          visible: {
            ...prevState.visible,
            scenegraph: !prevState.visible.scenegraph
          }
        }));
      }
    });
  }, []);

  const handleStreetMixURL = () => {
    const isStreetMix = window.location.hash.includes('streetmix');
    if (isStreetMix) {
      STREET.notify.warningMessage(
        'Hit save if you want to save changes to the scene. Otherwise changes will be lost'
      );
    }
  };

  const onModalTextureOnClose = (value) => {
    setState((prevState) => ({
      ...prevState,
      isModalTexturesOpen: false
    }));
    if (state.textureOnClose) {
      state.textureOnClose(value);
    }
  };

  const renderComponentsToggle = () => {
    if (!state.inspectorEnabled || !state.entity || state.visible.attributes) {
      return null;
    }

    return (
      <div className="toggle-sidebar right">
        <a
          onClick={() => {
            Events.emit('togglesidebar', { which: 'attributes' });
          }}
          className="fa fa-plus"
          title="Show components"
        />
      </div>
    );
  };

  const renderSceneGraphToggle = () => {
    if (!state.inspectorEnabled || state.visible.scenegraph) {
      return null;
    }
    return (
      <div className="toggle-sidebar left">
        <a
          onClick={() => {
            Events.emit('togglesidebar', { which: 'scenegraph' });
          }}
          className="fa fa-plus"
          title="Show scenegraph"
        />
      </div>
    );
  };

  const scene = state.sceneEl;
  const isEditor = !!state.inspectorEnabled;

  return (
    <div id="inspectorContainer">
      {renderSceneGraphToggle()}
      {renderComponentsToggle()}
      <ToolbarWrapper />
      {isEditor && (
        <div>
          <SceneGraph
            scene={scene}
            selectedEntity={state.entity}
            visible={state.visible.scenegraph}
          />
          <div id="rightPanel">
            <ComponentsSidebar
              entity={state.entity}
              visible={state.visible.attributes}
            />
          </div>
        </div>
      )}
      <ScreenshotModal />
      <SignInModal />
      <PaymentModal />
      <ScenesModal />
      <ProfileModal />
      <IntroModal />
      <LoadScript
        googleMapsApiKey={firebaseConfig.apiKey}
        libraries={GOOGLE_MAPS_LIBRARIES}
      >
        <GeoModal />
      </LoadScript>
      <ModalTextures
        isOpen={state.isModalTexturesOpen}
        selectedTexture={state.selectedTexture}
        onClose={onModalTextureOnClose}
      />

      {state.inspectorEnabled && (
        <div id="geo">
          <GeoPanel />
        </div>
      )}
      {state.inspectorEnabled && (
        <div id="action-bar">
          <ActionBar />
        </div>
      )}
      {state.inspectorEnabled && (
        <div id="scene-title" className="clickable">
          <SceneEditTitle />
        </div>
      )}
      {state.inspectorEnabled && (
        <div id="zoom-help-buttons">
          <ZoomButtons />
          <HelpButton />
        </div>
      )}
      {state.inspectorEnabled && (
        <div className="clickable">
          <AddLayerPanel />
        </div>
      )}
    </div>
  );
}
