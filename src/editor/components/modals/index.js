import { lazy } from 'react';

const ModalHelp = lazy(() =>
  import('./ModalHelp').then((module) => ({ default: module.ModalHelp }))
);
const ModalTextures = lazy(() =>
  import('./ModalTextures').then((module) => ({
    default: module.ModalTextures
  }))
);
const ScreenshotModal = lazy(() =>
  import('./ScreenshotModal').then((module) => ({
    default: module.ScreenshotModal
  }))
);
const SignInModal = lazy(() =>
  import('./SignInModal').then((module) => ({
    default: module.SignInModal
  }))
);
const ProfileModal = lazy(() =>
  import('./ProfileModal').then((module) => ({
    default: module.ProfileModal
  }))
);
const ScenesModal = lazy(() =>
  import('./ScenesModal').then((module) => ({
    default: module.ScenesModal
  }))
);
const SavingModal = lazy(() =>
  import('./SavingModal').then((module) => ({
    default: module.SavingModal
  }))
);

export {
  ModalHelp,
  ModalTextures,
  ScreenshotModal,
  SignInModal,
  ProfileModal,
  ScenesModal,
  SavingModal
};
