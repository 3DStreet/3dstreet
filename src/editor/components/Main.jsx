import { useState, useEffect } from 'react';
import RightPanel from './scenegraph/RightPanel';
import Events from '../lib/Events';
import ModalTextures from './modals/ModalTextures';
import SceneGraph from './scenegraph/SceneGraph';
import { ScreenshotModal } from './modals/ScreenshotModal';
import { ShareModal } from './modals/ShareModal';
// import ViewportHUD from "./viewport/ViewportHUD";
import { SignInModal } from './modals/SignInModal';
import { ProfileModal } from './modals/ProfileModal';
import { firebaseConfig, app } from '@shared/services/firebase.js';
import { LoadScript } from '@react-google-maps/api';
import { GeoModal } from './modals/GeoModal';
import { ScenesModal } from './modals/ScenesModal';
import EditorUpgradeModal from './EditorUpgradeModal.jsx';
import { AddLayerPanel } from './elements/AddLayerPanel';
import { NewModal } from './modals/NewModal';
import { LoadingSceneModal } from './modals/LoadingSceneModal';
import { ToolbarWrapper } from './scenegraph/ToolbarWrapper.jsx';
import { ActionBar } from './elements/ActionBar';
import { PrimaryToolbar } from './elements/PrimaryToolbar';
import { PlayModeControls } from './elements/PlayModeControls';
import useStore from '@/store';
import { AIChatProvider } from '../contexts/AIChatContext';
import styles from './Main.module.scss';

// Define the libraries array as a constant outside of the component
const GOOGLE_MAPS_LIBRARIES = ['places'];

export default function Main() {
  const [state, setState] = useState({
    entity: null,
    isModalTexturesOpen: false,
    sceneEl: AFRAME.scenes[0]
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
      <ToolbarWrapper />
      {!isInspectorEnabled && <PlayModeControls />}
      {isInspectorEnabled && (
        <AIChatProvider firebaseApp={app}>
          <div>
            <SceneGraph scene={scene} selectedEntity={state.entity} />
            <RightPanel entity={state.entity} />
            <div className={`clickable ${styles.primaryToolbarDock}`}>
              <PrimaryToolbar />
            </div>
            <div className={`clickable ${styles.actionBarDock}`}>
              <ActionBar selectedEntity={state.entity} />
            </div>
          </div>
        </AIChatProvider>
      )}
      <ScreenshotModal />
      <ShareModal />
      <SignInModal />
      <EditorUpgradeModal />
      <ScenesModal />
      <ProfileModal />
      <NewModal />
      <LoadingSceneModal />
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
        <div className="clickable">
          <AddLayerPanel />
        </div>
      )}
    </div>
  );
}
