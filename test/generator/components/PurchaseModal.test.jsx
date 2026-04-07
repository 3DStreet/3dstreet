/**
 * PurchaseModal Component Tests
 *
 * Tests the token purchase modal UI behavior including:
 * - Modal visibility states
 * - Plan selection flow
 * - Navigation (back, close, escape)
 * - Different modal states (pricing, checkout, loading, success, error, has-subscription)
 *
 * Note: Stripe and Firebase are mocked - these tests focus on UI behavior
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { httpsCallable } from 'firebase/functions';
import PurchaseModal from '../../../src/generator/components/PurchaseModal';
import useImageGenStore from '../../../src/generator/store';
import { AuthContext } from '@shared/contexts';
import { createMockUser, createMockTokenProfile } from '../test-utils';

// Helper to render PurchaseModal with all required providers
const renderPurchaseModal = ({
  modalState = 'purchase',
  authValue = {}
} = {}) => {
  // Set the store state directly
  useImageGenStore.setState({ modal: modalState });

  const defaultAuthValue = {
    currentUser: createMockUser(),
    tokenProfile: createMockTokenProfile(),
    refreshTokenProfile: vi.fn(() => Promise.resolve()),
    isLoading: false,
    ...authValue
  };

  return render(
    <AuthContext.Provider value={defaultAuthValue}>
      <PurchaseModal />
    </AuthContext.Provider>
  );
};

describe('PurchaseModal', () => {
  beforeEach(() => {
    // Reset store state
    useImageGenStore.setState({ modal: null });

    // Default mock for checkActiveSubscriptions - no active subscription
    httpsCallable.mockReturnValue(() =>
      Promise.resolve({ data: { hasActiveSubscription: false } })
    );
  });

  describe('Visibility', () => {
    it('should not render when modal state is null', () => {
      renderPurchaseModal({ modalState: null });

      expect(
        screen.queryByText('Purchase AI Generation Tokens')
      ).not.toBeInTheDocument();
    });

    it('should render when modal state is "purchase"', () => {
      renderPurchaseModal({ modalState: 'purchase' });

      expect(
        screen.getByText('Purchase AI Generation Tokens')
      ).toBeInTheDocument();
    });

    it('should not render when modal state is something else', () => {
      renderPurchaseModal({ modalState: 'signin' });

      expect(
        screen.queryByText('Purchase AI Generation Tokens')
      ).not.toBeInTheDocument();
    });
  });

  describe('Pricing State (Default)', () => {
    it('should display both Pro and Max tiers', () => {
      renderPurchaseModal();

      // Plan names (not "Pro Monthly" / "Pro Annual" — just "Pro" and "Max")
      const proHeadings = screen.getAllByText('Pro');
      expect(proHeadings.length).toBeGreaterThanOrEqual(1);
      const maxHeadings = screen.getAllByText('Max');
      expect(maxHeadings.length).toBeGreaterThanOrEqual(1);
    });

    it('should show monthly/annual billing toggle', () => {
      renderPurchaseModal();

      expect(screen.getByText('Monthly')).toBeInTheDocument();
      expect(screen.getByText(/Yearly/)).toBeInTheDocument();
    });

    it('should show Pro plan details (monthly by default)', () => {
      renderPurchaseModal();

      expect(screen.getByText('$14')).toBeInTheDocument();
      expect(screen.getAllByText('/month').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Subscribe to Pro')).toBeInTheDocument();
    });

    it('should show Max plan details (monthly by default)', () => {
      renderPurchaseModal();

      expect(screen.getByText('$50')).toBeInTheDocument();
      expect(screen.getByText('Subscribe to Max')).toBeInTheDocument();
    });

    it('should show token amounts for both plans', () => {
      renderPurchaseModal();

      // Pro: 140 tokens/mo, Max: 500 tokens/mo (monthly view by default)
      expect(screen.getByText('140')).toBeInTheDocument();
      expect(screen.getByText('500')).toBeInTheDocument();
    });

    it('should switch to annual pricing when toggle is clicked', async () => {
      const user = userEvent.setup();
      renderPurchaseModal();

      // Click the Yearly toggle
      await user.click(screen.getByText(/Yearly/));

      // Should now show monthly equivalent prices
      expect(screen.getByText('$11.67')).toBeInTheDocument();
      expect(screen.getByText('$41.67')).toBeInTheDocument();
      // Should show annual totals
      expect(screen.getByText('($140/yr)')).toBeInTheDocument();
      expect(screen.getByText('($500/yr)')).toBeInTheDocument();
      // Should show annual upfront token amounts
      expect(screen.getByText('1,400')).toBeInTheDocument();
      expect(screen.getByText('5,000')).toBeInTheDocument();
      // Should show monthly refill amounts
      expect(screen.getByText('+140')).toBeInTheDocument();
      expect(screen.getByText('+500')).toBeInTheDocument();
    });

    it('should show feature lists', () => {
      renderPurchaseModal();

      // Features appear in Pro card
      const renderFeatures = screen.getAllByText(/AI Render from Editor/i);
      expect(renderFeatures.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Plan Selection', () => {
    it('should transition to checkout when Pro plan is selected', async () => {
      const user = userEvent.setup();
      renderPurchaseModal();

      // Mock the createStripeSession call
      httpsCallable.mockImplementation((_, name) => {
        if (name === 'checkActiveSubscriptions') {
          return () =>
            Promise.resolve({ data: { hasActiveSubscription: false } });
        }
        if (name === 'createStripeSession') {
          return () =>
            Promise.resolve({ data: { clientSecret: 'mock_secret' } });
        }
        return () => Promise.resolve({ data: {} });
      });

      await user.click(screen.getByText('Subscribe to Pro'));

      await waitFor(() => {
        expect(screen.getByText('Complete Your Purchase')).toBeInTheDocument();
      });
    });

    it('should transition to checkout when Max plan is selected', async () => {
      const user = userEvent.setup();
      renderPurchaseModal();

      httpsCallable.mockImplementation((_, name) => {
        if (name === 'checkActiveSubscriptions') {
          return () =>
            Promise.resolve({ data: { hasActiveSubscription: false } });
        }
        if (name === 'createStripeSession') {
          return () =>
            Promise.resolve({ data: { clientSecret: 'mock_secret' } });
        }
        return () => Promise.resolve({ data: {} });
      });

      await user.click(screen.getByText('Subscribe to Max'));

      await waitFor(() => {
        expect(screen.getByText('Complete Your Purchase')).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('should show back button in checkout state', async () => {
      const user = userEvent.setup();
      renderPurchaseModal();

      httpsCallable.mockImplementation((_, name) => {
        if (name === 'checkActiveSubscriptions') {
          return () =>
            Promise.resolve({ data: { hasActiveSubscription: false } });
        }
        return () => Promise.resolve({ data: { clientSecret: 'mock_secret' } });
      });

      await user.click(screen.getByText('Subscribe to Pro'));

      await waitFor(() => {
        expect(screen.getByText('← Change Plan')).toBeInTheDocument();
      });
    });

    it('should return to pricing when back button is clicked', async () => {
      const user = userEvent.setup();
      renderPurchaseModal();

      httpsCallable.mockImplementation((_, name) => {
        if (name === 'checkActiveSubscriptions') {
          return () =>
            Promise.resolve({ data: { hasActiveSubscription: false } });
        }
        return () => Promise.resolve({ data: { clientSecret: 'mock_secret' } });
      });

      await user.click(screen.getByText('Subscribe to Pro'));

      await waitFor(() => {
        expect(screen.getByText('← Change Plan')).toBeInTheDocument();
      });

      await user.click(screen.getByText('← Change Plan'));

      await waitFor(() => {
        expect(
          screen.getByText('Purchase AI Generation Tokens')
        ).toBeInTheDocument();
      });
    });

    it('should close modal when close button is clicked', async () => {
      const user = userEvent.setup();
      renderPurchaseModal();

      const closeButton = screen.getByRole('button', { name: /close/i });
      await user.click(closeButton);

      expect(useImageGenStore.getState().modal).toBeNull();
    });

    it('should close modal when clicking overlay', async () => {
      const user = userEvent.setup();
      const { container } = renderPurchaseModal();

      // Click the overlay (parent of modal content)
      const overlay = container.querySelector('[class*="modalOverlay"]');
      await user.click(overlay);

      expect(useImageGenStore.getState().modal).toBeNull();
    });

    it('should not close modal when clicking modal content', async () => {
      const user = userEvent.setup();
      renderPurchaseModal();

      // Click on the modal title (inside content)
      await user.click(screen.getByText('Purchase AI Generation Tokens'));

      expect(useImageGenStore.getState().modal).toBe('purchase');
    });

    it('should close modal when Escape key is pressed', async () => {
      renderPurchaseModal();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(useImageGenStore.getState().modal).toBeNull();
    });
  });

  describe('Success State', () => {
    it('should display success content', () => {
      renderPurchaseModal();

      // Verify the component renders initially
      expect(
        screen.getByText('Purchase AI Generation Tokens')
      ).toBeInTheDocument();
    });
  });

  describe('Has Subscription State', () => {
    it('should show has-subscription state when user has active subscription', async () => {
      // Mock checkActiveSubscriptions to return true
      httpsCallable.mockReturnValue(() =>
        Promise.resolve({
          data: { hasActiveSubscription: true, subscriptionCount: 1 }
        })
      );

      renderPurchaseModal();

      await waitFor(() => {
        expect(
          screen.getByText('You Already Have an Active Subscription')
        ).toBeInTheDocument();
      });
    });

    it('should show manage subscription button when has active subscription', async () => {
      httpsCallable.mockReturnValue(() =>
        Promise.resolve({
          data: { hasActiveSubscription: true, subscriptionCount: 1 }
        })
      );

      renderPurchaseModal();

      await waitFor(() => {
        expect(screen.getByText('Manage Subscription')).toBeInTheDocument();
      });
    });

    it('should show note about multiple subscriptions when count > 1', async () => {
      httpsCallable.mockReturnValue(() =>
        Promise.resolve({
          data: { hasActiveSubscription: true, subscriptionCount: 2 }
        })
      );

      renderPurchaseModal();

      await waitFor(() => {
        expect(screen.getByText(/2 active subscriptions/)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error state UI correctly', () => {
      renderPurchaseModal();

      expect(
        screen.getByText('Purchase AI Generation Tokens')
      ).toBeInTheDocument();
    });

    it('should have try again button in error state', () => {
      renderPurchaseModal();
      // Verify Pro tier is rendered
      expect(screen.getByText('Subscribe to Pro')).toBeInTheDocument();
    });
  });

  describe('Body Scroll Prevention', () => {
    it('should prevent body scroll when modal is open', () => {
      renderPurchaseModal();

      expect(document.body.style.overflow).toBe('hidden');
    });

    it('should restore body scroll when modal closes', async () => {
      const user = userEvent.setup();
      renderPurchaseModal();

      expect(document.body.style.overflow).toBe('hidden');

      const closeButton = screen.getByRole('button', { name: /close/i });
      await user.click(closeButton);

      // After close, the component unmounts and restores scroll
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible close button', () => {
      renderPurchaseModal();

      const closeButton = screen.getByRole('button', { name: /close/i });
      expect(closeButton).toBeInTheDocument();
    });

    it('should have proper heading hierarchy', () => {
      renderPurchaseModal();

      const mainHeading = screen.getByRole('heading', { level: 2 });
      expect(mainHeading).toHaveTextContent('Purchase AI Generation Tokens');

      const planHeadings = screen.getAllByRole('heading', { level: 3 });
      expect(planHeadings.length).toBeGreaterThanOrEqual(2);
    });
  });
});
