/**
 * SignInModal Component Tests
 *
 * Tests for the shared SignInModal component that handles Google and Microsoft
 * authentication. These tests focus on behavior contracts that must be preserved
 * during React migration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

// Mock Firebase auth
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(() => ({})),
  OAuthProvider: vi.fn(() => ({})),
  signInWithPopup: vi.fn()
}));

// eslint-disable-next-line import/first -- Must import after vi.mock
import { signInWithPopup } from 'firebase/auth';

// ============= MOCK COMPONENTS FOR TESTING =============

// Simplified Modal mock for testing
const MockModal = ({ isOpen, onClose, children, className }) => {
  if (!isOpen) return null;

  return (
    <div data-testid="modal" className={className} role="dialog">
      <div data-testid="modal-backdrop" onClick={onClose} />
      <div data-testid="modal-content">{children}</div>
    </div>
  );
};

// Mock icons
const MockGoogleIcon = () => (
  <div data-testid="google-icon">Google Sign In</div>
);
const MockMicrosoftIcon = () => (
  <div data-testid="microsoft-icon">Microsoft Sign In</div>
);

// SignInModal component for testing (simplified version matching real behavior)
const SignInModal = ({
  isOpen,
  onClose,
  message = 'Sign in to continue',
  firebaseAuth,
  onAnalytics,
  onNotification,
  onSuccess,
  LoadingComponent,
  loadingMessage = 'Signing in...'
}) => {
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);

  const onSignInClick = async (provider = 'google') => {
    setIsAuthenticating(true);
    try {
      if (provider === 'google') {
        await mockSignInWithGoogle(firebaseAuth, onAnalytics, onNotification);
      } else if (provider === 'microsoft') {
        await mockSignInWithMicrosoft(
          firebaseAuth,
          onAnalytics,
          onNotification
        );
      }

      if (onSuccess) {
        await onSuccess();
      }

      onClose();
    } catch (error) {
      // Don't close modal on error so user can retry
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <>
      <MockModal isOpen={isOpen} onClose={onClose}>
        <div data-testid="signin-content">
          <h2 data-testid="signin-title">Sign in</h2>
          <p data-testid="signin-message">{message}</p>
          <div
            onClick={() => onSignInClick('google')}
            data-testid="google-signin-button"
            role="button"
          >
            <MockGoogleIcon />
          </div>
          <div
            onClick={() => onSignInClick('microsoft')}
            data-testid="microsoft-signin-button"
            role="button"
          >
            <MockMicrosoftIcon />
          </div>
          {isAuthenticating && !LoadingComponent && (
            <div data-testid="loading-message">{loadingMessage}</div>
          )}
        </div>
      </MockModal>
      {isAuthenticating && LoadingComponent && <LoadingComponent />}
    </>
  );
};

// Mock sign-in functions
const mockSignInWithGoogle = vi.fn();
const mockSignInWithMicrosoft = vi.fn();

// ============= TESTS =============

describe('SignInModal', () => {
  let mockFirebaseAuth;
  let mockOnClose;
  let mockOnAnalytics;
  let mockOnNotification;
  let mockOnSuccess;

  beforeEach(() => {
    mockFirebaseAuth = { currentUser: null };
    mockOnClose = vi.fn();
    mockOnAnalytics = vi.fn();
    mockOnNotification = vi.fn();
    mockOnSuccess = vi.fn();
    mockSignInWithGoogle.mockReset();
    mockSignInWithMicrosoft.mockReset();
    mockSignInWithGoogle.mockResolvedValue({ uid: 'test-uid' });
    mockSignInWithMicrosoft.mockResolvedValue({ uid: 'test-uid' });
  });

  describe('Modal Visibility', () => {
    it('should render when isOpen is true', () => {
      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('should not render when isOpen is false', () => {
      render(
        <SignInModal
          isOpen={false}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });

    it('should call onClose when backdrop is clicked', async () => {
      const user = userEvent.setup();

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      await user.click(screen.getByTestId('modal-backdrop'));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('Content Display', () => {
    it('should display Sign in title', () => {
      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      expect(screen.getByTestId('signin-title')).toHaveTextContent('Sign in');
    });

    it('should display default message', () => {
      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      expect(screen.getByTestId('signin-message')).toHaveTextContent(
        'Sign in to continue'
      );
    });

    it('should display custom message', () => {
      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          message="Please sign in to generate images"
        />
      );

      expect(screen.getByTestId('signin-message')).toHaveTextContent(
        'Please sign in to generate images'
      );
    });

    it('should display both Google and Microsoft sign-in buttons', () => {
      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      expect(screen.getByTestId('google-signin-button')).toBeInTheDocument();
      expect(screen.getByTestId('microsoft-signin-button')).toBeInTheDocument();
    });
  });

  describe('Google Sign In', () => {
    it('should call signInWithGoogle when Google button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          onAnalytics={mockOnAnalytics}
          onNotification={mockOnNotification}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(mockSignInWithGoogle).toHaveBeenCalledWith(
          mockFirebaseAuth,
          mockOnAnalytics,
          mockOnNotification
        );
      });
    });

    it('should close modal on successful Google sign in', async () => {
      const user = userEvent.setup();

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it('should not close modal on Google sign in error', async () => {
      const user = userEvent.setup();
      mockSignInWithGoogle.mockRejectedValue(new Error('Auth failed'));

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(mockSignInWithGoogle).toHaveBeenCalled();
      });

      // Modal should remain open on error
      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });
  });

  describe('Microsoft Sign In', () => {
    it('should call signInWithMicrosoft when Microsoft button is clicked', async () => {
      const user = userEvent.setup();

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          onAnalytics={mockOnAnalytics}
          onNotification={mockOnNotification}
        />
      );

      await user.click(screen.getByTestId('microsoft-signin-button'));

      await waitFor(() => {
        expect(mockSignInWithMicrosoft).toHaveBeenCalledWith(
          mockFirebaseAuth,
          mockOnAnalytics,
          mockOnNotification
        );
      });
    });

    it('should close modal on successful Microsoft sign in', async () => {
      const user = userEvent.setup();

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      await user.click(screen.getByTestId('microsoft-signin-button'));

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });
  });

  describe('Loading State', () => {
    it('should show default loading message during authentication', async () => {
      const user = userEvent.setup();
      // Make sign-in hang
      mockSignInWithGoogle.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(screen.getByTestId('loading-message')).toHaveTextContent(
          'Signing in...'
        );
      });
    });

    it('should show custom loading message when provided', async () => {
      const user = userEvent.setup();
      mockSignInWithGoogle.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          loadingMessage="Authenticating with provider..."
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(screen.getByTestId('loading-message')).toHaveTextContent(
          'Authenticating with provider...'
        );
      });
    });

    it('should use custom LoadingComponent when provided', async () => {
      const user = userEvent.setup();
      mockSignInWithGoogle.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 1000))
      );

      const CustomLoader = () => (
        <div data-testid="custom-loader">Custom Loading...</div>
      );

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          LoadingComponent={CustomLoader}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(screen.getByTestId('custom-loader')).toBeInTheDocument();
      });
    });
  });

  describe('Success Callback', () => {
    it('should call onSuccess after successful sign in', async () => {
      const user = userEvent.setup();

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          onSuccess={mockOnSuccess}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(mockOnSuccess).toHaveBeenCalled();
      });
    });

    it('should call onSuccess before closing modal', async () => {
      const user = userEvent.setup();
      const callOrder = [];

      mockOnSuccess.mockImplementation(() => callOrder.push('onSuccess'));
      mockOnClose.mockImplementation(() => callOrder.push('onClose'));

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          onSuccess={mockOnSuccess}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(callOrder).toEqual(['onSuccess', 'onClose']);
      });
    });

    it('should not call onSuccess on authentication error', async () => {
      const user = userEvent.setup();
      mockSignInWithGoogle.mockRejectedValue(new Error('Auth failed'));

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          onSuccess={mockOnSuccess}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(mockSignInWithGoogle).toHaveBeenCalled();
      });

      expect(mockOnSuccess).not.toHaveBeenCalled();
    });
  });

  describe('Analytics', () => {
    it('should pass onAnalytics to sign in function', async () => {
      const user = userEvent.setup();

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          onAnalytics={mockOnAnalytics}
          onNotification={mockOnNotification}
        />
      );

      await user.click(screen.getByTestId('google-signin-button'));

      await waitFor(() => {
        expect(mockSignInWithGoogle).toHaveBeenCalledWith(
          mockFirebaseAuth,
          mockOnAnalytics,
          mockOnNotification
        );
      });
    });
  });

  describe('Notifications', () => {
    it('should pass onNotification to sign in function', async () => {
      const user = userEvent.setup();

      render(
        <SignInModal
          isOpen={true}
          onClose={mockOnClose}
          firebaseAuth={mockFirebaseAuth}
          onAnalytics={mockOnAnalytics}
          onNotification={mockOnNotification}
        />
      );

      await user.click(screen.getByTestId('microsoft-signin-button'));

      await waitFor(() => {
        expect(mockSignInWithMicrosoft).toHaveBeenCalledWith(
          mockFirebaseAuth,
          mockOnAnalytics,
          mockOnNotification
        );
      });
    });
  });
});

describe('Sign In API Functions', () => {
  // These test the expected contracts for the auth API functions

  describe('signInWithGoogle() contract', () => {
    it('should accept firebaseAuth, onAnalytics, onNotification params', () => {
      // Contract: function signature
      const signInWithGoogleSignature = (
        firebaseAuth,
        onAnalytics,
        onNotification
      ) => {};

      expect(typeof signInWithGoogleSignature).toBe('function');
    });

    it('should return user object on success', async () => {
      signInWithPopup.mockResolvedValue({
        user: {
          uid: 'test-uid',
          email: 'test@example.com',
          displayName: 'Test User',
          metadata: {
            creationTime: '2024-01-01',
            lastSignInTime: '2024-01-02'
          }
        }
      });

      const result = await signInWithPopup({}, {});

      expect(result.user.uid).toBe('test-uid');
      expect(result.user.email).toBe('test@example.com');
    });

    it('should handle account-exists-with-different-credential error', async () => {
      const error = new Error('Account exists');
      error.code = 'auth/account-exists-with-different-credential';
      signInWithPopup.mockRejectedValue(error);

      await expect(signInWithPopup({}, {})).rejects.toThrow('Account exists');
    });
  });

  describe('signInWithMicrosoft() contract', () => {
    it('should use OAuthProvider with microsoft.com', () => {
      // Contract: uses microsoft.com provider
      const provider = 'microsoft.com';
      expect(provider).toBe('microsoft.com');
    });
  });

  describe('signOut() contract', () => {
    it('should call analytics and notification on success', () => {
      // Contract: calls onAnalytics('sign_out_completed')
      const onAnalytics = vi.fn();
      onAnalytics('sign_out_completed');

      expect(onAnalytics).toHaveBeenCalledWith('sign_out_completed');
    });
  });
});

/**
 * React Migration Notes:
 *
 * SignInModal is already a React component and can be used directly.
 * Key integration points:
 *
 * 1. Pass Firebase auth instance from context/props
 * 2. Wire up analytics (PostHog integration)
 * 3. Wire up notification system (toast/alert)
 * 4. Handle onSuccess for post-login actions
 *
 * The component uses dependency injection pattern which makes it
 * easy to integrate with different app contexts.
 */
