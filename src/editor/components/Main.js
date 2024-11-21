import { HelpButton, ZoomButtons } from './components';
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
import { ToolbarWrapper } from './scenegraph/ToolbarWrapper.js';
import useStore from '@/store';

THREE.ImageUtils.crossOrigin = '';

// Define the libraries array as a constant outside of the component
const GOOGLE_MAPS_LIBRARIES = ['places'];

export default function Main() {
  const [state, setState] = useState({
    entity: null,
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

  const scene = state.sceneEl;
  const isInspectorEnabled = useStore((state) => state.isInspectorEnabled);

  return (
    <div id="inspectorContainer">
      <ToolbarWrapper />
      {isInspectorEnabled && (
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

      {isInspectorEnabled && (
        <>
          <div id="action-bar">
            <ActionBar selectedEntity={state.entity} />
          </div>
          <div id="scene-title" className="clickable">
            <SceneEditTitle />
          </div>
          <div id="zoom-help-buttons">
            <ZoomButtons />
            <HelpButton />
            <div className="clickable">
              <AddLayerPanel />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
