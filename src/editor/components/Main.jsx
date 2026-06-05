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
import { ContextViewButton } from './elements/ContextViewButton';
import useStore from '@/store';
import { AIChatProvider } from '../contexts/AIChatContext';
import { useNavMode } from '../lib/nav-experimental/useNavMode';
import { RecoveryCue } from '../lib/nav-experimental/RecoveryCue.jsx';
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
  // ActionBar, in BOTH plan view and pedestal/street view. The bar's width is
  // dynamic (conditional buttons), and in pedestal mode the dock stretches to
  // full width while its buttons stay centred — so we measure the inner
  // ActionBar element (the dock's first child), not the dock, and pin the
  // compass to the page centre (left: 50%) pushed right by half that width +
  // a gap. Measuring the inner toolbar makes the offset identical in both
  // modes, so the compass stays put when switching to street view.
  const actionBarDockRef = useRef(null);
  const compassDockRef = useRef(null);
  // TASK-025 v2 (R2-E): the context view control docks just to the RIGHT of the
  // compass (which is itself right of the centred ActionBar) and is BOTTOM-
  // ALIGNED with the compass (its bottom edge level with the compass bottom
  // edge — NOT vertically centred). Nothing sits right of the compass today, so
  // there is no collision. Positioned by the SAME place() effect and
  // ResizeObserver as the compass — no second observer (round-1 M4).
  const contextButtonDockRef = useRef(null);
  useEffect(() => {
    if (!isInspectorEnabled || !isExperimentalNav()) return;
    const barDock = actionBarDockRef.current;
    const compassDock = compassDockRef.current;
    const contextDock = contextButtonDockRef.current;
    if (!barDock || !compassDock || !contextDock) return;
    const GAP = 12;
    const COMPASS_SIZE = 64; // .compass is 64x64 (Compass.module.scss)
    const BAR_BOTTOM = 16; // all docks sit 16px off the viewport bottom
    const place = () => {
      const bar = barDock.firstElementChild || barDock;
      // The compass's computed bottom edge — reused for true bottom-alignment of
      // the context control (R2-REV-E: control.bottom = compass.bottom, NOT
      // compass.bottom − controlSize/2 which would centre it).
      const compassBottom =
        BAR_BOTTOM + bar.offsetHeight / 2 - COMPASS_SIZE / 2;
      // Compass — just to the right of the centred toolbar.
      compassDock.style.transform = `translateX(${bar.offsetWidth / 2 + GAP}px)`;
      compassDock.style.bottom = `${compassBottom}px`;
      // Context control — further right: a GAP past the compass's right edge.
      // Compass left edge (its translateX target, both docks pinned at
      // left: 50%) = barWidth/2 + GAP; its right edge adds COMPASS_SIZE; then a
      // GAP to the control's left edge.
      const contextLeft = bar.offsetWidth / 2 + GAP + COMPASS_SIZE + GAP;
      contextDock.style.transform = `translateX(${contextLeft}px)`;
      // Bottom-aligned with the compass: same bottom edge (R2-REV-E).
      contextDock.style.bottom = `${compassBottom}px`;
    };
    place();
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ro) ro.observe(barDock.firstElementChild || barDock);
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
            {isExperimentalNav() && (
              <div
                ref={contextButtonDockRef}
                className={dockClass(`clickable ${styles.contextButtonDock}`)}
              >
                <ContextViewButton />
              </div>
            )}
            {isExperimentalNav() && <RecoveryCue />}
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
