/**
 * TokenSync Component Tests
 *
 * Tests the token sync component that bridges React state to vanilla JS:
 * - Syncs tokenProfile to window.authState
 * - Dispatches authStateChanged event
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import TokenSync from '../../../src/generator/components/TokenSync';
import { AuthContext } from '@shared/contexts';
import { createMockTokenProfile } from '../test-utils';

// Helper to render TokenSync with providers
const renderTokenSync = (authValue = {}) => {
  const defaultAuthValue = {
    currentUser: null,
    tokenProfile: null,
    refreshTokenProfile: vi.fn(),
    isLoading: false,
    ...authValue
  };

  return render(
    <AuthContext.Provider value={defaultAuthValue}>
      <TokenSync />
    </AuthContext.Provider>
  );
};

describe('TokenSync', () => {
  let originalAuthState;
  let authStateChangedHandler;

  beforeEach(() => {
    // Setup window.authState
    originalAuthState = window.authState;
    window.authState = {
      currentUser: null,
      isAuthenticated: false,
      isPro: false,
      tokenProfile: null
    };

    // Setup event listener spy
    authStateChangedHandler = vi.fn();
    window.addEventListener('authStateChanged', authStateChangedHandler);
  });

  afterEach(() => {
    // Restore original state
    window.authState = originalAuthState;
    window.removeEventListener('authStateChanged', authStateChangedHandler);
  });

  describe('Rendering', () => {
    it('should render nothing (returns null)', () => {
      const { container } = renderTokenSync();
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Token Sync', () => {
    it('should sync tokenProfile to window.authState on mount', async () => {
      const tokenProfile = createMockTokenProfile({ genToken: 25 });

      renderTokenSync({ tokenProfile });

      await waitFor(() => {
        expect(window.authState.tokenProfile).toEqual(tokenProfile);
      });
    });

    it('should dispatch authStateChanged event on mount', async () => {
      const tokenProfile = createMockTokenProfile();

      renderTokenSync({ tokenProfile });

      await waitFor(() => {
        expect(authStateChangedHandler).toHaveBeenCalled();
      });
    });

    it('should sync null tokenProfile', async () => {
      renderTokenSync({ tokenProfile: null });

      await waitFor(() => {
        expect(window.authState.tokenProfile).toBeNull();
      });
    });
  });

  describe('Token Updates', () => {
    it('should update window.authState when tokenProfile changes', async () => {
      const initialTokenProfile = createMockTokenProfile({ genToken: 10 });
      const updatedTokenProfile = createMockTokenProfile({ genToken: 5 });

      const { rerender } = render(
        <AuthContext.Provider
          value={{
            currentUser: null,
            tokenProfile: initialTokenProfile,
            refreshTokenProfile: vi.fn(),
            isLoading: false
          }}
        >
          <TokenSync />
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(window.authState.tokenProfile.genToken).toBe(10);
      });

      // Rerender with updated token profile
      rerender(
        <AuthContext.Provider
          value={{
            currentUser: null,
            tokenProfile: updatedTokenProfile,
            refreshTokenProfile: vi.fn(),
            isLoading: false
          }}
        >
          <TokenSync />
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(window.authState.tokenProfile.genToken).toBe(5);
      });
    });

    it('should dispatch event when tokenProfile changes', async () => {
      const initialTokenProfile = createMockTokenProfile({ genToken: 10 });
      const updatedTokenProfile = createMockTokenProfile({ genToken: 5 });

      const { rerender } = render(
        <AuthContext.Provider
          value={{
            currentUser: null,
            tokenProfile: initialTokenProfile,
            refreshTokenProfile: vi.fn(),
            isLoading: false
          }}
        >
          <TokenSync />
        </AuthContext.Provider>
      );

      // Clear the initial call
      authStateChangedHandler.mockClear();

      // Rerender with updated token profile
      rerender(
        <AuthContext.Provider
          value={{
            currentUser: null,
            tokenProfile: updatedTokenProfile,
            refreshTokenProfile: vi.fn(),
            isLoading: false
          }}
        >
          <TokenSync />
        </AuthContext.Provider>
      );

      await waitFor(() => {
        expect(authStateChangedHandler).toHaveBeenCalled();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing window.authState gracefully', async () => {
      // Remove authState
      delete window.authState;

      // Should not throw
      expect(() => {
        renderTokenSync({ tokenProfile: createMockTokenProfile() });
      }).not.toThrow();
    });

    it('should handle undefined tokenProfile', async () => {
      renderTokenSync({ tokenProfile: undefined });

      await waitFor(() => {
        expect(window.authState.tokenProfile).toBeUndefined();
      });
    });
  });
});
