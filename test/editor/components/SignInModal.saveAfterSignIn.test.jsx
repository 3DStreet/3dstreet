/**
 * The editor SignInModal saves the scene after sign-in only when sign-in
 * was opened to save or share it (store.openSignInToSave). Any other
 * sign-in (profile button, a link, a paywall) used to save the empty editor
 * as a new cloud scene, because getCurrentSceneId() returns '' — not null —
 * when no scene is open.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import useStore from '@/store';

const saveSceneWithScreenshot = vi.fn(() => Promise.resolve('scene-id'));
vi.mock('@/editor/lib/SceneUtils', () => ({
  saveSceneWithScreenshot: (...args) => saveSceneWithScreenshot(...args)
}));
vi.mock('@/editor/components/modals/SavingModal', () => ({
  SavingModal: () => null
}));

// Capture the callbacks the editor wrapper gives the shared modal.
let sharedProps;
vi.mock('@/shared/auth/components', () => ({
  SignInModal: (props) => {
    sharedProps = props;
    return null;
  }
}));

const { SignInModal } =
  await import('@/editor/components/modals/SignInModal/SignInModal.component.jsx');

const renderModal = () =>
  render(
    <IntlProvider locale="en" messages={{}}>
      <SignInModal />
    </IntlProvider>
  );

describe('SignInModal: save after sign-in', () => {
  beforeEach(() => {
    saveSceneWithScreenshot.mockClear();
    sharedProps = null;
    useStore.setState({
      saveAfterSignIn: false,
      modal: null,
      previousModal: null
    });
    globalThis.STREET = {
      ...(globalThis.STREET || {}),
      utils: { getCurrentSceneId: () => '' }
    };
  });

  it('saves nothing after a plain sign-in, even with no scene open', async () => {
    useStore.getState().setModal('signin');
    renderModal();
    await sharedProps.onSuccess();
    expect(saveSceneWithScreenshot).not.toHaveBeenCalled();
  });

  it('saves once when sign-in was opened to save the scene', async () => {
    useStore.getState().openSignInToSave();
    expect(useStore.getState().modal).toBe('signin');
    renderModal();
    await sharedProps.onSuccess();
    expect(saveSceneWithScreenshot).toHaveBeenCalledTimes(1);
    // saveScene decides between a copy and a new scene; never forced.
    expect(saveSceneWithScreenshot.mock.calls[0][1]).toBe(false);
    expect(useStore.getState().saveAfterSignIn).toBe(false);
  });

  it('forgets the request when sign-in is closed without signing in', () => {
    useStore.getState().openSignInToSave();
    renderModal();
    sharedProps.onClose();
    expect(useStore.getState().saveAfterSignIn).toBe(false);
  });
});
