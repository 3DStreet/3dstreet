import { create } from 'zustand';
import { devtools, subscribeWithSelector } from 'zustand/middleware';
import posthog from 'posthog-js';

const firstModal = () => {
  let modal = window.location.hash.includes('payment')
    ? 'payment'
    : !window.location.hash.length
      ? 'scenes'
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
        sceneId: null,
        setSceneId: (newSceneId) => set({ sceneId: newSceneId }),
        sceneTitle: null,
        setSceneTitle: (newSceneTitle) => set({ sceneTitle: newSceneTitle }),
        newScene: () =>
          set({ sceneId: null, sceneTitle: null, authorId: null }),
        authorId: null,
        setAuthorId: (newAuthorId) => set({ authorId: newAuthorId }),
        modal: firstModal(),
        setModal: (newModal) => {
          const currentModal = useStore.getState().modal;
          if (currentModal) {
            posthog.capture('modal_closed', { modal: currentModal });
          }
          if (newModal) {
            posthog.capture('modal_opened', { modal: newModal });
          }
          set({ modal: newModal });
        },
        startcheckout: (postCheckout) => {
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

export default useStore;
