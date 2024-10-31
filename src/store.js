import { create } from 'zustand';

const useStore = create((set) => ({
  sceneId: null,
  setSceneId: (newSceneId) => set({ sceneId: newSceneId }),
  authorId: null,
  setAuthorId: (newAuthorId) => set({ authorId: newAuthorId })
}));

export default useStore;
