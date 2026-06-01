import { useState, useEffect, useRef } from 'react';
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
import { Compass } from './elements/Compass';
import useStore from '@/store';
import { AIChatProvider } from '../contexts/AIChatContext';
import { useNavMode } from '../lib/nav-experimental/useNavMode';
import { isExperimentalNav } from '../lib/nav-experimental/index.js';
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
  const { isPedestalMode } = useNavMode();
  const dockClass = (base) =>
    isPedestalMode ? `${base} ${styles.pedestalMode}` : base;

  // TASK-011: anchor the compass dock just to the right of the bottom-centre
  // ActionBar. The ActionBar's width is dynamic (conditional buttons), so we
  // measure it rather than use a fixed offset: the compass dock is pinned to
  // the page centre (left: 50%) and pushed right by half the bar's width + a
  // gap, keeping the bar itself centred. In pedestal mode the bar goes
  // full-width, so we clear the override and let the CSS fixed fallback apply.
  const actionBarDockRef = useRef(null);
  const compassDockRef = useRef(null);
  useEffect(() => {
    if (!isInspectorEnabled || !isExperimentalNav()) return;
    const barDock = actionBarDockRef.current;
    const compassDock = compassDockRef.current;
    if (!barDock || !compassDock) return;
    const GAP = 12;
    const place = () => {
      if (isPedestalMode) {
        compassDock.style.transform = '';
        return;
      }
      compassDock.style.transform = `translateX(${barDock.offsetWidth / 2 + GAP}px)`;
    };
    place();
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro) ro.observe(barDock);
    window.addEventListener('resize', place);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [isInspectorEnabled, isPedestalMode]);

  return (
    <div id="inspectorContainer">
      <ToolbarWrapper />
      {isInspectorEnabled && (
        <AIChatProvider firebaseApp={app}>
          <div>
            <SceneGraph scene={scene} selectedEntity={state.entity} />
            <RightPanel entity={state.entity} />
            <div
              className={dockClass(`clickable ${styles.primaryToolbarDock}`)}
            >
              <PrimaryToolbar />
            </div>
            <div
              ref={actionBarDockRef}
              className={dockClass(`clickable ${styles.actionBarDock}`)}
            >
              <ActionBar selectedEntity={state.entity} />
            </div>
            {isExperimentalNav() && (
              <div
                ref={compassDockRef}
                className={dockClass(`clickable ${styles.compassDock}`)}
              >
                <Compass />
              </div>
            )}
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
