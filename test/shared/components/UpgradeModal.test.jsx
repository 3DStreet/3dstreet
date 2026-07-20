/**
 * UpgradeModal Component Tests
 *
 * Tests the shared upgrade modal used by both editor and generator:
 * - Visibility (controlled via isOpen prop)
 * - Pricing UI: title, shared feature list, billing toggle, Pro/Max tier cards
 * - Plan selection (Go Pro / Go Max) transitions to checkout state
 * - Has-subscription routing via checkActiveSubscriptions
 * - Close (button, overlay, escape)
 * - Body scroll lock
 *
 * Stripe / Firebase / posthog are mocked in test/setup.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc } from 'firebase/firestore';
import UpgradeModal from '../../../src/shared/components/UpgradeModal';
import { AuthContext } from '@shared/contexts';

// The modal records the pricing-nudge signal (userSignals.lastPaymentModalAt)
// on open; the global setup mocks the db object but not the firestore API.
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'mock-doc' })),
  setDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => 'mock-server-timestamp')
}));

const renderModal = (props = {}, authValue = {}) => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    source: 'test',
    ...props
  };

  const defaultAuth = {
    currentUser: {
      uid: 'test-user-123',
      email: 'test@example.com',
      getIdToken: () => Promise.resolve('mock-token')
    },
    tokenProfile: { genToken: 10, credToken: 0 },
    refreshTokenProfile: vi.fn(() => Promise.resolve()),
    isLoading: false,
    ...authValue
  };

  return {
    onClose: defaultProps.onClose,
    ...render(
      <AuthContext.Provider value={defaultAuth}>
        <UpgradeModal {...defaultProps} />
      </AuthContext.Provider>
    )
  };
};

describe('UpgradeModal', () => {
  beforeEach(() => {
    httpsCallable.mockReturnValue(() =>
      Promise.resolve({ data: { hasActiveSubscription: false } })
    );
  });

  describe('Visibility', () => {
    it('renders nothing when isOpen is false', () => {
      renderModal({ isOpen: false });
      expect(screen.queryByText('Upgrade to Pro')).not.toBeInTheDocument();
    });

    it('renders pricing view when isOpen is true', () => {
      renderModal();
      expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
    });
  });

  describe('Pricing view', () => {
    it('shows title, subtitle, and Go Pro CTA', () => {
      renderModal();
      expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
      expect(
        screen.getByText('Unlock the full 3DStreet toolkit.')
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Go Pro' })
      ).toBeInTheDocument();
    });

    it('shows the shared feature list once, with per-tier tokens on the cards', () => {
      renderModal();
      // Shared Pro features render once above the cards.
      expect(
        screen.getAllByText('Download JPEG snapshots without watermark')
      ).toHaveLength(1);
      // The token allotment lives on each tier card, not the shared list.
      expect(screen.getByText('100 AI tokens / month')).toBeInTheDocument();
      expect(screen.getByText('500 AI tokens / month')).toBeInTheDocument();
    });

    it('defaults to monthly billing, showing both tier prices', () => {
      renderModal();
      expect(screen.getByText('$10')).toBeInTheDocument(); // Pro monthly
      expect(screen.getByText('$50')).toBeInTheDocument(); // Max monthly
      // "billed monthly" appears once per card (Pro + Max).
      expect(screen.getAllByText('billed monthly')).toHaveLength(2);
      expect(screen.queryByText(/billed yearly/)).not.toBeInTheDocument();
    });

    it('switches to yearly pricing when the Yearly toggle is clicked', async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByRole('tab', { name: /Yearly/ }));

      expect(screen.getByText('$7')).toBeInTheDocument(); // Pro yearly
      expect(screen.getByText('$35')).toBeInTheDocument(); // Max yearly
      expect(screen.getByText(/billed yearly, \$84\/year/)).toBeInTheDocument();
      expect(
        screen.getByText(/billed yearly, \$420\/year/)
      ).toBeInTheDocument();
      expect(screen.queryByText('billed monthly')).not.toBeInTheDocument();
    });

    it('keeps each tier monthly token floor on both billing cycles', async () => {
      const user = userEvent.setup();
      renderModal();

      // Tokens are a monthly floor (Pro 100, Max 500), identical on monthly and
      // yearly — annual carries no up-front bonus.
      expect(screen.getByText('100 AI tokens / month')).toBeInTheDocument();
      expect(screen.getByText('500 AI tokens / month')).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: /Yearly/ }));
      expect(screen.getByText('100 AI tokens / month')).toBeInTheDocument();
      expect(screen.getByText('500 AI tokens / month')).toBeInTheDocument();
    });

    it('shows Save 30% pill on the yearly toggle', () => {
      renderModal();
      expect(screen.getByText('Save 30%')).toBeInTheDocument();
    });

    it('shows Cancel anytime footer', () => {
      renderModal();
      expect(screen.getByText('Cancel anytime')).toBeInTheDocument();
    });
  });

  describe('Unauthenticated', () => {
    it('replaces price/CTA with sign-in prompt when no currentUser', () => {
      renderModal({}, { currentUser: null });

      // Pricing chrome (title + features) still renders so users see what
      // they would get; the call-to-action shifts to sign-in.
      expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Sign in to 3DStreet Cloud' })
      ).toBeInTheDocument();

      expect(
        screen.queryByRole('button', { name: 'Go Pro' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('tab', { name: 'Monthly' })
      ).not.toBeInTheDocument();
      expect(screen.queryByText('$10')).not.toBeInTheDocument();
    });

    it('calls onSignIn when the sign-in button is clicked', async () => {
      const user = userEvent.setup();
      const onSignIn = vi.fn();
      renderModal({ onSignIn }, { currentUser: null });

      await user.click(
        screen.getByRole('button', { name: 'Sign in to 3DStreet Cloud' })
      );

      expect(onSignIn).toHaveBeenCalled();
    });

    it('mentions existing Pro users in the prompt copy', () => {
      renderModal({}, { currentUser: null });
      expect(screen.getByText(/access Pro/i)).toBeInTheDocument();
    });
  });

  describe('Plan selection → checkout', () => {
    it('transitions to checkout state when Go Pro is clicked', async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByRole('button', { name: 'Go Pro' }));

      await waitFor(() => {
        expect(screen.getByText('Complete your upgrade')).toBeInTheDocument();
      });
    });

    it('transitions to checkout state when Go Max is clicked', async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByRole('button', { name: 'Go Max' }));

      await waitFor(() => {
        expect(screen.getByText('Complete your upgrade')).toBeInTheDocument();
      });
    });

    it('calls onCheckoutStart with the default (monthly) billing cycle', async () => {
      const user = userEvent.setup();
      const onCheckoutStart = vi.fn();
      renderModal({ onCheckoutStart });

      await user.click(screen.getByRole('button', { name: 'Go Pro' }));

      expect(onCheckoutStart).toHaveBeenCalledWith('monthly');
    });

    it('passes "yearly" to onCheckoutStart when Yearly is toggled', async () => {
      const user = userEvent.setup();
      const onCheckoutStart = vi.fn();
      renderModal({ onCheckoutStart });

      await user.click(screen.getByRole('tab', { name: /Yearly/ }));
      await user.click(screen.getByRole('button', { name: 'Go Pro' }));

      expect(onCheckoutStart).toHaveBeenCalledWith('yearly');
    });
  });

  describe('Deep-link activation', () => {
    // Opened via a tier-specific hash (e.g. docs "Go Max" → #payment-max-annual),
    // the modal should skip card selection and go straight to that tier + cycle's
    // checkout — but never bypass the existing-subscriber / already-Pro guards.
    it('auto-advances to checkout for the deep-linked tier + cycle', async () => {
      const onCheckoutStart = vi.fn();
      renderModal({
        initialTier: 'max',
        initialCycle: 'yearly',
        onCheckoutStart
      });

      await waitFor(() => {
        expect(screen.getByText('Complete your upgrade')).toBeInTheDocument();
      });
      expect(onCheckoutStart).toHaveBeenCalledWith('yearly');
    });

    it('routes an existing subscriber to billing portal instead of checkout', async () => {
      httpsCallable.mockReturnValue(() =>
        Promise.resolve({
          data: { hasActiveSubscription: true, subscriptionCount: 1 }
        })
      );
      renderModal({ initialTier: 'max', initialCycle: 'yearly' });

      await waitFor(() => {
        expect(
          screen.getByText('You Already Have an Active Subscription')
        ).toBeInTheDocument();
      });
      expect(
        screen.queryByText('Complete your upgrade')
      ).not.toBeInTheDocument();
    });

    it('does not auto-advance an already-Pro user', async () => {
      const onAlreadyPro = vi.fn();
      renderModal(
        { initialTier: 'max', initialCycle: 'yearly', onAlreadyPro },
        {
          currentUser: {
            uid: 'pro-user',
            email: 'pro@example.com',
            isPro: true,
            getIdToken: () => Promise.resolve('mock-token')
          }
        }
      );

      await waitFor(() => {
        expect(onAlreadyPro).toHaveBeenCalled();
      });
      expect(
        screen.queryByText('Complete your upgrade')
      ).not.toBeInTheDocument();
    });
  });

  describe('Checkout state', () => {
    it('shows back button that returns to pricing', async () => {
      const user = userEvent.setup();
      renderModal();

      await user.click(screen.getByRole('button', { name: 'Go Pro' }));

      const back = await screen.findByRole('button', { name: '← Back' });
      await user.click(back);

      expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
    });
  });

  describe('Has-subscription routing', () => {
    it('routes to has-subscription view when user already subscribes', async () => {
      httpsCallable.mockReturnValue(() =>
        Promise.resolve({
          data: { hasActiveSubscription: true, subscriptionCount: 1 }
        })
      );

      renderModal();

      await waitFor(() => {
        expect(
          screen.getByText('You Already Have an Active Subscription')
        ).toBeInTheDocument();
      });
    });

    it('shows Manage Subscription button in has-subscription view', async () => {
      httpsCallable.mockReturnValue(() =>
        Promise.resolve({
          data: { hasActiveSubscription: true, subscriptionCount: 1 }
        })
      );

      renderModal();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Manage Subscription' })
        ).toBeInTheDocument();
      });
    });
  });

  describe('Already-Pro short-circuit', () => {
    // Covers the post-login race where an anonymous user hits the paywall,
    // signs in, and turns out to already be Pro (claim granted via Stripe,
    // team membership, or admin override). We want the modal to bail out
    // rather than re-pitching pricing.
    it('fires onAlreadyPro when currentUser.isPro is true', async () => {
      const onAlreadyPro = vi.fn();
      renderModal(
        { onAlreadyPro },
        {
          currentUser: {
            uid: 'pro-user',
            email: 'pro@example.com',
            isPro: true,
            getIdToken: () => Promise.resolve('mock-token')
          }
        }
      );

      await waitFor(() => {
        expect(onAlreadyPro).toHaveBeenCalled();
      });
    });

    it('falls back to onClose when onAlreadyPro is not provided', async () => {
      const { onClose } = renderModal(
        {},
        {
          currentUser: {
            uid: 'pro-user',
            email: 'pro@example.com',
            isPro: true,
            getIdToken: () => Promise.resolve('mock-token')
          }
        }
      );

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe('Close behavior', () => {
    it('calls onClose when close button is clicked', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();

      await user.click(screen.getByRole('button', { name: /close/i }));

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose when overlay is clicked', async () => {
      const user = userEvent.setup();
      const { container, onClose } = renderModal();

      const overlay = container.querySelector('[class*="modalOverlay"]');
      await user.click(overlay);

      expect(onClose).toHaveBeenCalled();
    });

    it('calls onClose on Escape key', () => {
      const { onClose } = renderModal();

      // Listener is on keyup (matches the shared Modal component to avoid
      // the keydown→close→keyup race that double-closes when the editor
      // routes back to a previous modal).
      fireEvent.keyUp(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalled();
    });

    it('does not close when clicking modal content', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal();

      await user.click(screen.getByText('Upgrade to Pro'));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Pricing-nudge signal (userSignals.lastPaymentModalAt)', () => {
    beforeEach(() => {
      doc.mockClear();
      setDoc.mockClear();
    });

    it('records the signal when a signed-in non-Pro user opens the modal', async () => {
      renderModal();
      await waitFor(() => expect(setDoc).toHaveBeenCalled());
      expect(doc).toHaveBeenCalledWith(
        expect.anything(),
        'userSignals',
        'test-user-123'
      );
      expect(setDoc.mock.calls[0][1]).toEqual({
        userId: 'test-user-123',
        lastPaymentModalAt: 'mock-server-timestamp'
      });
      expect(setDoc.mock.calls[0][2]).toEqual({ merge: true });
    });

    it('does not record for signed-out users or when closed', () => {
      renderModal({}, { currentUser: null });
      expect(setDoc).not.toHaveBeenCalled();

      renderModal({ isOpen: false });
      expect(setDoc).not.toHaveBeenCalled();
    });

    it('does not record for Pro users', () => {
      renderModal(
        { onAlreadyPro: vi.fn() },
        {
          currentUser: {
            uid: 'pro-user',
            email: 'pro@example.com',
            isPro: true,
            getIdToken: () => Promise.resolve('mock-token')
          }
        }
      );
      expect(setDoc).not.toHaveBeenCalled();
    });

    it('a failing write never breaks the paywall UI', async () => {
      setDoc.mockImplementationOnce(() => {
        throw new Error('firestore offline');
      });
      renderModal();
      expect(screen.getByText('Upgrade to Pro')).toBeInTheDocument();
    });
  });

  describe('Body scroll lock', () => {
    it('locks body scroll while open', () => {
      renderModal();
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('restores body scroll when closed', () => {
      const { rerender } = renderModal();
      expect(document.body.style.overflow).toBe('hidden');

      rerender(
        <AuthContext.Provider
          value={{
            currentUser: null,
            tokenProfile: null,
            refreshTokenProfile: vi.fn(),
            isLoading: false
          }}
        >
          <UpgradeModal isOpen={false} onClose={vi.fn()} />
        </AuthContext.Provider>
      );

      expect(document.body.style.overflow).toBe('');
    });
  });
});
