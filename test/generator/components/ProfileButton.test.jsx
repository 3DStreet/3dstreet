/**
 * Generator ProfileButton Component Tests
 *
 * Tests the generator-specific ProfileButton wrapper that:
 * - Shows sign-in modal when not logged in
 * - Integrates with posthog analytics
 * - Uses the store for modal state
 */
/* eslint-disable react/prop-types -- inline test-double components, not production */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import posthog from 'posthog-js';
import ProfileButton from '../../../src/generator/components/ProfileButton';
import useImageGenStore from '../../../src/generator/store';
import { AuthContext } from '@shared/contexts';
import { createMockUser } from '../test-utils';

// Mock the shared auth components.
//
// The real shared ProfileButton (with showHoverCard) always fires `onClick`
// for analytics, and — when signed out — offers a "Sign in" entry in its menu
// that fires `onSignIn`. The generator wrapper wires sign-in through
// `onSignIn`, so the mock reproduces both paths: clicking always calls
// `onClick`, and a signed-out click also invokes `onSignIn` (standing in for
// picking "Sign in" from the menu).
vi.mock('@shared/auth/components', () => ({
  ProfileButton: ({ currentUser, isLoading, onClick, onSignIn }) => (
    <button
      data-testid="shared-profile-button"
      onClick={() => {
        onClick?.();
        if (!currentUser) onSignIn?.();
      }}
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : currentUser ? 'Profile' : 'Sign In'}
    </button>
  ),
  SignInModal: ({ isOpen, onClose, message }) =>
    isOpen ? (
      <div data-testid="signin-modal">
        <p>{message}</p>
        <button onClick={onClose}>Close</button>
      </div>
    ) : null
}));

// Helper to render ProfileButton with providers
const renderProfileButton = (authValue = {}) => {
  const defaultAuthValue = {
    currentUser: null,
    tokenProfile: null,
    refreshTokenProfile: vi.fn(),
    isLoading: false,
    ...authValue
  };

  return render(
    <AuthContext.Provider value={defaultAuthValue}>
      <ProfileButton />
    </AuthContext.Provider>
  );
};

describe('ProfileButton (Generator)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useImageGenStore.setState({ modal: null });
  });

  describe('Rendering', () => {
    it('should render the shared ProfileButton', () => {
      renderProfileButton();
      expect(screen.getByTestId('shared-profile-button')).toBeInTheDocument();
    });

    it('should show "Sign In" when user is not logged in', () => {
      renderProfileButton({ currentUser: null });
      expect(screen.getByText('Sign In')).toBeInTheDocument();
    });

    it('should show "Profile" when user is logged in', () => {
      renderProfileButton({ currentUser: createMockUser() });
      expect(screen.getByText('Profile')).toBeInTheDocument();
    });

    it('should show loading state when isLoading is true', () => {
      renderProfileButton({ isLoading: true });
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('Click Behavior - Not Logged In', () => {
    it('should open sign-in modal when clicked and not logged in', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: null });

      await user.click(screen.getByTestId('shared-profile-button'));

      await waitFor(() => {
        expect(screen.getByTestId('signin-modal')).toBeInTheDocument();
      });
    });

    it('should track analytics when clicked', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: null });

      await user.click(screen.getByTestId('shared-profile-button'));

      expect(posthog.capture).toHaveBeenCalledWith('profile_button_clicked', {
        is_logged_in: false
      });
    });

    it('should set modal state to "signin"', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: null });

      await user.click(screen.getByTestId('shared-profile-button'));

      expect(useImageGenStore.getState().modal).toBe('signin');
    });
  });

  describe('Click Behavior - Logged In', () => {
    it('should not open sign-in modal when clicked and logged in', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: createMockUser() });

      await user.click(screen.getByTestId('shared-profile-button'));

      expect(screen.queryByTestId('signin-modal')).not.toBeInTheDocument();
    });

    it('should track analytics with is_logged_in: true', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: createMockUser() });

      await user.click(screen.getByTestId('shared-profile-button'));

      expect(posthog.capture).toHaveBeenCalledWith('profile_button_clicked', {
        is_logged_in: true
      });
    });

    it('should not change modal state when logged in', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: createMockUser() });

      await user.click(screen.getByTestId('shared-profile-button'));

      expect(useImageGenStore.getState().modal).toBeNull();
    });
  });

  describe('Loading State', () => {
    it('should not respond to clicks when loading', async () => {
      const user = userEvent.setup();
      renderProfileButton({ isLoading: true });

      await user.click(screen.getByTestId('shared-profile-button'));

      expect(posthog.capture).not.toHaveBeenCalled();
      expect(useImageGenStore.getState().modal).toBeNull();
    });
  });

  describe('SignInModal Integration', () => {
    it('should display custom message in sign-in modal', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: null });

      await user.click(screen.getByTestId('shared-profile-button'));

      await waitFor(() => {
        expect(
          screen.getByText('Sign in to use AI image generation.')
        ).toBeInTheDocument();
      });
    });

    it('should close modal when close button is clicked', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: null });

      // Open modal
      await user.click(screen.getByTestId('shared-profile-button'));
      expect(screen.getByTestId('signin-modal')).toBeInTheDocument();

      // Close modal
      await user.click(screen.getByText('Close'));
      expect(screen.queryByTestId('signin-modal')).not.toBeInTheDocument();
    });

    it('should clear modal state when closed', async () => {
      const user = userEvent.setup();
      renderProfileButton({ currentUser: null });

      await user.click(screen.getByTestId('shared-profile-button'));
      expect(useImageGenStore.getState().modal).toBe('signin');

      await user.click(screen.getByText('Close'));
      expect(useImageGenStore.getState().modal).toBeNull();
    });
  });
});
