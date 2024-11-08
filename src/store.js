import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
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
  devtools(
    (set) => ({
      sceneId: null,
      setSceneId: (newSceneId) => set({ sceneId: newSceneId }),
      sceneTitle: null,
      setSceneTitle: (newSceneTitle) => set({ sceneTitle: newSceneTitle }),
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
      }
    }),
    { name: 'MyZustandStore' }
  )
);

export default useStore;
