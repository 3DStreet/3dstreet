import { ZoomButtons } from './components';
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
import { ScenesModal } from './modals/ScenesModal';
import { PaymentModal } from './modals/PaymentModal';
import { AddLayerPanel } from './components/AddLayerPanel';
import { NewModal } from './modals/NewModal';
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
      console.log('event.which', event.which);
      if (event.which === 'all') {
        setState((prevState) => {
          const isVisible =
            prevState.visible.scenegraph || prevState.visible.attributes;
          return {
            ...prevState,
            visible: {
              scenegraph: !isVisible,
              attributes: !isVisible
            }
          };
        });
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
      <ToolbarWrapper entity={state.entity} />
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
      <NewModal />
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
          <div id="zoom-help-buttons">
            <ZoomButtons />
          </div>
          <div className="clickable">
            <AddLayerPanel />
          </div>
        </>
      )}
    </div>
  );
}
