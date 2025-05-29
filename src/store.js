import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import posthog from 'posthog-js';
import Events from './editor/lib/Events';
import canvasRecorder from './editor/lib/CanvasRecorder';

const firstModal = () => {
  let modal = window.location.hash.includes('payment')
    ? 'payment'
    : !window.location.hash.length
      ? 'new'
      : null;
  const isStreetMix = window.location.hash.includes('streetmix');
  if (isStreetMix) {
    modal = localStorage.getItem('shownIntro') ? null : 'intro';
  }
  return modal;
};

const useStore = create(
  subscribeWithSelector(
    devtools(
      (set) => ({
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
        sceneTitle: null,
        setSceneTitle: (newSceneTitle) => set({ sceneTitle: newSceneTitle }),
        newScene: () =>
          set({
            sceneId: null,
            sceneTitle: null,
            authorId: null,
            projectInfo: {
              description: '',
              projectArea: '',
              currentCondition: '',
              problemStatement: '',
              proposedSolutions: ''
            }
          }),
        authorId: null, // not used anywhere yet, we still use the metadata component
        setAuthorId: (newAuthorId) => set({ authorId: newAuthorId }), // not used anywhere yet
        unitsPreference: localStorage.getItem('unitsPreference') || 'metric',
        setUnitsPreference: (newUnitsPreference) => {
          localStorage.setItem('unitsPreference', newUnitsPreference);
          set({ unitsPreference: newUnitsPreference });
        },
        // Project info data (replaces project-info component)
        projectInfo: {
          description: '',
          projectArea: '',
          currentCondition: '',
          problemStatement: '',
          proposedSolutions: ''
        },
        setProjectInfo: (newProjectInfo) =>
          set({
            projectInfo: {
              ...useStore.getState().projectInfo,
              ...newProjectInfo
            }
          }),
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
          posthog.capture('modal_opened', { modal: 'payment' });
          posthog.capture('start_checkout');
          set({ modal: 'payment', postCheckout });
        },
        postCheckout: null,
        isInspectorEnabled: true,
        setIsInspectorEnabled: (newIsInspectorEnabled) => {
          if (newIsInspectorEnabled) {
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

// Subscribe to projectInfo changes and trigger cloud save
useStore.subscribe(
  (state) => state.projectInfo,
  (projectInfo) => {
    // Don't trigger on initial state (empty values)
    const hasContent = Object.values(projectInfo).some((value) => value !== '');
    if (hasContent) {
      // Emit the same event that triggers autosave
      Events.emit('historychanged', true);
    }
  }
);

export default useStore;
