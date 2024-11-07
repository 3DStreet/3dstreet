import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

let store;

const initializeStore = () => {
  console.log('Store Call Stack:', new Error().stack);
  return create(
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
};

const getStore = () => {
  if (!store) {
    store = initializeStore();
  }
  return store;
};

export default getStore();
