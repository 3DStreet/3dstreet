import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import posthog from 'posthog-js';
import Events from './editor/lib/Events';
import canvasRecorder from './editor/lib/CanvasRecorder';
import { auth } from '@shared/services/firebase';

const firstModal = () => {
  const hash = window.location.hash;
  let modal = hash.includes('payment')
    ? 'payment'
    : hash.includes('profile') || hash.includes('/modal/profile')
      ? 'profile'
      : !hash.length
        ? 'new'
        : null;
  const isStreetMix = hash.includes('streetmix');
  if (isStreetMix) {
    modal = localStorage.getItem('shownIntro') ? null : 'intro';
  }
  return modal;
};

const useStore = create(
  subscribeWithSelector(
    devtools(
      (set) => ({
        // Recording state. The Recording UI was removed in panels-v2
        // (PR #1566); these stubs and the canvasRecorder import stay so
        // we can restore the feature soon without re-wiring the store.
        isRecording: false,
        setIsRecording: (newIsRecording) =>
          set({ isRecording: newIsRecording }),
        checkRecordingStatus: () => {
          const recordingStatus = canvasRecorder.isCurrentlyRecording();
          const currentState = useStore.getState().isRecording;
          if (currentState !== recordingStatus) {
            set({ isRecording: recordingStatus });
          }
          return recordingStatus;
        },
        startRecordingCheck: () => {
          // First check immediately
          useStore.getState().checkRecordingStatus();

          // Then set up an interval
          const intervalId = setInterval(() => {
            useStore.getState().checkRecordingStatus();
          }, 1000);

          // Store the interval ID for cleanup
          set({ recordingCheckIntervalId: intervalId });
        },
        stopRecordingCheck: () => {
          const { recordingCheckIntervalId } = useStore.getState();
          if (recordingCheckIntervalId) {
            clearInterval(recordingCheckIntervalId);
            set({ recordingCheckIntervalId: null });
          }
        },
        recordingCheckIntervalId: null,

        sceneId: null, // not used anywhere yet, we still use the metadata component
        setSceneId: (newSceneId) => set({ sceneId: newSceneId }), // not used anywhere yet
        isSavingScene: false,
        saveScene: (newDoSaveAs, newDoPromptTitle) =>
          set({
            isSavingScene: true,
            doSaveAs: newDoSaveAs,
            doPromptTitle: newDoPromptTitle
          }),
        postSaveScene: () => set({ isSavingScene: false, doSaveAs: false }),
        doSaveAs: false,
        // Scene loading state
        isLoadingScene: false,
        loadingSceneProgress: 0,
        loadingSceneMessage: 'Loading scene...',
        loadingSceneError: null,
        startLoadingScene: (message) =>
          set({
            isLoadingScene: true,
            loadingSceneProgress: 0,
            loadingSceneMessage: message || 'Loading scene...',
            loadingSceneError: null
          }),
        updateLoadingProgress: (progress, message) =>
          set((state) => ({
            loadingSceneProgress: Math.min(progress, 100),
            ...(message && { loadingSceneMessage: message })
          })),
        finishLoadingScene: () =>
          set({
            isLoadingScene: false,
            loadingSceneProgress: 100,
            loadingSceneMessage: '',
            loadingSceneError: null
          }),
        errorLoadingScene: (errorMessage) =>
          set({
            loadingSceneError: errorMessage,
            loadingSceneMessage: 'Error loading scene'
          }),
        sceneTitle: null,
        setSceneTitle: (newSceneTitle) => set({ sceneTitle: newSceneTitle }),
        locationString: null,
        setLocationString: (newLocationString) =>
          set({ locationString: newLocationString }),
        newScene: () =>
          set({
            sceneId: null,
            sceneTitle: null,
            authorId: null,
            locationString: null
          }),
        authorId: null, // not used anywhere yet, we still use the metadata component
        setAuthorId: (newAuthorId) => set({ authorId: newAuthorId }), // not used anywhere yet
        unitsPreference: localStorage.getItem('unitsPreference') || 'metric',
        setUnitsPreference: (newUnitsPreference) => {
          localStorage.setItem('unitsPreference', newUnitsPreference);
          set({ unitsPreference: newUnitsPreference });
        },
        modal: firstModal(),
        previousModal: null,
        setModal: (newModal, rememberPrevious = false) => {
          const currentModal = useStore.getState().modal;
          if (rememberPrevious && currentModal) {
            set({ modal: newModal, previousModal: currentModal });
          } else {
            set({ modal: newModal });
          }
        },
        returnToPreviousModal: () => {
          const { previousModal } = useStore.getState();
          if (previousModal) {
            set({ modal: previousModal, previousModal: null });
          } else {
            set({ modal: null });
          }
        },
        startCheckout: (postCheckout) => {
          // Snapshot the current modal so closing/completing the upgrade
          // flow lands the user back where they started (e.g. geo modal).
          // Note: a subsequent setModal('signin', true) will overwrite this,
          // which is intentional — the signin chain returns to upgrade, and
          // we accept losing the deeper return in that case rather than
          // building a multi-level stack.
          const currentModal = useStore.getState().modal;
          posthog.capture('modal_opened', {
            modal: 'payment',
            source: postCheckout
          });
          set({
            modal: 'payment',
            postCheckout,
            previousModal: currentModal
          });
        },
        postCheckout: null,
        // In-memory session flag — true after the watermark paywall has been
        // shown once this page load. Resets on reload. Throttles the
        // download-time upsell so non-Pro users only see it once per sitting.
        watermarkUpsellShown: false,
        setWatermarkUpsellShown: (value) =>
          set({ watermarkUpsellShown: value }),
        // Optional callback set by the trigger site before opening the paywall.
        // Invoked by the modal's secondary CTA (e.g. "Continue free with
        // watermark") so the user's original action — like the watermarked
        // download — runs after a soft decline. Cleared on any modal exit.
        pendingPostCheckoutAction: null,
        setPendingPostCheckoutAction: (fn) =>
          set({ pendingPostCheckoutAction: fn }),
        // GeoJSON import data for pre-filling the Geo Modal
        geojsonImportData: null,
        setGeojsonImportData: (data) => set({ geojsonImportData: data }),
        isGridVisible: true,
        setIsGridVisible: (newIsGridVisible) => {
          Events.emit('gridvisibilitychanged', newIsGridVisible);
          set({ isGridVisible: newIsGridVisible });
        },
        panelsVisible: true,
        setPanelsVisible: (newPanelsVisible) =>
          set({ panelsVisible: newPanelsVisible }),
        togglePanelsVisible: () =>
          set((state) => ({ panelsVisible: !state.panelsVisible })),
        rightPanelTab: 'properties',
        setRightPanelTab: (newTab) => set({ rightPanelTab: newTab }),
        isInspectorEnabled: true,
        setIsInspectorEnabled: (newIsInspectorEnabled) => {
          const viewerModeUI = document.getElementById('viewer-mode-ui');

          if (newIsInspectorEnabled) {
            posthog.capture('inspector_opened');
            AFRAME.INSPECTOR.open();

            // Make sure to stop recording when returning to editor mode
            if (canvasRecorder.isCurrentlyRecording()) {
              console.log('Stopping recording due to returning to editor mode');
              canvasRecorder.stopRecording();
            }

            // Hide viewer mode UI when inspector is visible
            if (viewerModeUI) {
              viewerModeUI.style.display = 'none';
            }
          } else {
            posthog.capture('inspector_closed');
            AFRAME.INSPECTOR.close();

            // Show viewer mode UI when inspector is not visible
            if (viewerModeUI) {
              viewerModeUI.style.display = 'block';
            }
          }
          set({ isInspectorEnabled: newIsInspectorEnabled });
        }
      }),
      { name: 'MyZustandStore' }
    )
  )
);

// Add beforeunload warning for unsaved changes
window.addEventListener('beforeunload', (event) => {
  // Check if scene is unsaved using the same logic as the Save button
  const sceneId = STREET.utils.getCurrentSceneId();
  const authorId = STREET.utils.getAuthorId();
  const currentUser = auth.currentUser;

  // Scene is unsaved if:
  // 1. No scene ID (new unsaved scene)
  // 2. Current user is not the author (scene not saved by current user)
  const isUnsaved = !sceneId || (currentUser && currentUser.uid !== authorId);

  // Only show warning if there are actual changes (undo button would be enabled) AND is unsaved
  const hasChanges = AFRAME.INSPECTOR?.history?.undos?.length > 0;

  if (isUnsaved && hasChanges) {
    const message = 'You have unsaved changes. Are you sure you want to leave?';
    event.preventDefault();
    event.returnValue = message;
    return message;
  }
});

export default useStore;
