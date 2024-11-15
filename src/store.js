import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

const useStore = create(
  devtools(
    (set) => ({
      sceneId: null,
      setSceneId: (newSceneId) => set({ sceneId: newSceneId }),
      sceneTitle: null,
      setSceneTitle: (newSceneTitle) => set({ sceneTitle: newSceneTitle }),
      authorId: null,
      setAuthorId: (newAuthorId) => set({ authorId: newAuthorId })
    }),
    { name: 'MyZustandStore' }
  )
);

export default useStore;
