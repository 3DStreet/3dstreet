import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import posthog from 'posthog-js';
import Events from './editor/lib/Events';
import canvasRecorder from './editor/lib/CanvasRecorder';
import { auth } from '@shared/services/firebase';
import { saveUserProfile } from '@shared/utils/username';
import { resolveInitialLocale, persistLocale } from './editor/i18n/config';

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
        // Blocking overlay shown while a GLB/glTF export is running (issue
        // #1797). Export work happens on the main thread and can take several
        // seconds on large scenes, so we surface a saving-style indicator.
        isExportingScene: false,
        exportingSceneMessage: '',
        startExportingScene: (message) =>
          set({
            isExportingScene: true,
            exportingSceneMessage: message || 'Exporting scene...'
          }),
        finishExportingScene: () =>
          set({ isExportingScene: false, exportingSceneMessage: '' }),
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
        // UI language for the localization experiment (#656). Auto-detected
        // from the browser on first load, then overridden by the user's stored
        // choice (persisted to localStorage via the View > Language menu).
        locale: resolveInitialLocale(),
        // User explicitly picked a language (View > Language). Persist locally,
        // track it, and — when signed in — save it to the user's Firestore
        // profile so the choice follows them across devices and the backend
        // can localize emails.
        setLocale: (newLocale) => {
          persistLocale(newLocale);
          posthog.capture('locale_changed', { locale: newLocale });
          posthog.register({ locale: newLocale });
          set({ locale: newLocale });
          const uid = auth.currentUser?.uid;
          if (uid) {
            saveUserProfile(uid, { locale: newLocale }).catch((error) =>
              console.error('Error saving locale to profile:', error)
            );
          }
        },
        // Apply a locale that came from elsewhere (e.g. the signed-in user's
        // stored profile preference) without writing it back to Firestore.
        hydrateLocale: (newLocale) => {
          if (newLocale === useStore.getState().locale) return;
          persistLocale(newLocale);
          posthog.register({ locale: newLocale });
          set({ locale: newLocale });
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
        // Payload for the shared ConfirmModal (title/message/labels + the
        // onConfirm callback). Rendered whenever modal === 'confirm'; a themed
        // in-app replacement for window.confirm. See ConfirmModal.
        confirmProps: null,
        showConfirm: (props) => set({ modal: 'confirm', confirmProps: props }),
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
        // True while the geo modal was auto-opened by the street-geo
        // activation gate (scene located but never activated). Lets the
        // modal distinguish "user dismissed the activation offer" from a
        // normal close so it can surface the recovery path. Cleared on
        // activation success and on dismiss.
        geoModalFromActivationGate: false,
        setGeoModalFromActivationGate: (value) =>
          set({ geoModalFromActivationGate: value }),
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
        // Play lifecycle state, mirrored from the play-mode A-Frame
        // system so React can render off it. Never set these directly —
        // call sceneEl.systems['play-mode'].start()/stop()/togglePause().
        isPlaying: false,
        isPlayPaused: false,
        // Where the current play session was entered from, stamped by
        // play-mode.start(): 'editor' (Start/P from an editing session)
        // or 'viewer' (viewer Start button, View-entry autoplay). Read
        // by stopPlaying() to pick Stop's destination. null while idle.
        playEntryOrigin: null,
        // Entry-aware Stop (#1824 Q1): every user-facing stop affordance
        // (viewer Stop button, Escape, gamepad Back) routes through here.
        // Entered Play from the editor → Stop returns to the editor;
        // a visitor (viewer origin) → Stop returns to View-idle.
        stopPlaying: () => {
          const playMode =
            document.querySelector('a-scene')?.systems?.['play-mode'];
          if (useStore.getState().playEntryOrigin === 'editor') {
            // setIsInspectorEnabled(true) stops play as part of opening
            // the editor, so this is one transition, not two.
            useStore.getState().setIsInspectorEnabled(true);
          } else {
            playMode?.stop();
          }
        },
        // Transient outcome shown by the viewer top bar's sim pill.
        //   null      – normal running state
        //   'finish'  – race-target was crossed (blue, pinned at finish time)
        //   'crash'   – a recent chassis collision (red, auto-clears)
        playOutcome: null,
        playOutcomeTimeMs: 0,
        // Race-finish detail consumed by the end-of-race banner.
        // playFinish: null | { finalMs, simMs, collisions, previousBestMs,
        //   isNewBest, deltaMs, courseKey, finishedAt }
        playFinish: null,
        // Enter viewer presentation. The camera needs no handoff: view
        // and edit share the editor camera and its controls (#1848), so
        // the viewer starts exactly where the editor was looking — and a
        // scene arriving in the viewer flies to its saved start view via
        // the same newScene camera animation the editor uses.
        enterViewerMode: () => {
          useStore.getState().setIsInspectorEnabled(false);
        },
        isInspectorEnabled: true,
        setIsInspectorEnabled: (newIsInspectorEnabled) => {
          if (newIsInspectorEnabled) {
            // Opening the inspector exits play mode (regardless of how
            // the open was triggered — Edit button, Escape,
            // programmatic). Subscribers tear down their own state via
            // the play-mode-stop scene event.
            document.querySelector('a-scene')?.systems?.['play-mode']?.stop();
            posthog.capture('inspector_opened');
            AFRAME.INSPECTOR.open();

            // Make sure to stop recording when returning to editor mode
            if (canvasRecorder.isCurrentlyRecording()) {
              console.log('Stopping recording due to returning to editor mode');
              canvasRecorder.stopRecording();
            }
          } else {
            posthog.capture('inspector_closed');
            AFRAME.INSPECTOR.close();
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

// Dev-only debug aid: lets the console (and browser-driven tests) drive UI
// state, e.g. window.useStore.getState().setModal('zoning').
if (process.env.NODE_ENV !== 'production') {
  window.useStore = useStore;
}

export default useStore;
