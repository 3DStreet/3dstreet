/**
 * Tiny Zustand store for image generator
 * Just manages modal state for now
 */
import { create } from 'zustand';

const useImageGenStore = create((set) => ({
  modal: null,
  setModal: (modal) => set({ modal })
}));

export default useImageGenStore;
