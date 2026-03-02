import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Mock Firebase modules
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
  getFunctions: vi.fn()
}));

vi.mock('@shared/services/firebase.js', () => ({
  functions: {},
  auth: {
    onAuthStateChanged: vi.fn((callback) => {
      // Return unsubscribe function
      return vi.fn();
    })
  },
  db: {},
  storage: {}
}));

// Mock Stripe
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() =>
    Promise.resolve({
      elements: vi.fn(),
      confirmPayment: vi.fn()
    })
  )
}));

vi.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ children }) => children,
  EmbeddedCheckout: () => null
}));

// Mock posthog
vi.mock('posthog-js', () => ({
  default: {
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn()
  }
}));

// Mock shared utils
vi.mock('@shared/utils/tokens', () => ({
  getTokenProfile: vi.fn(() => Promise.resolve({ genToken: 10 })),
  checkAndRefillProTokens: vi.fn(() => Promise.resolve(null))
}));

vi.mock('@shared/auth/api/user', () => ({
  isUserPro: vi.fn(() =>
    Promise.resolve({
      isPro: false,
      isProSubscription: false,
      isProDomain: false,
      teamDomain: null
    })
  )
}));

// Mock FluxUI for image-upload-utils
vi.mock('../../src/generator/main.js', () => ({
  default: {
    showNotification: vi.fn()
  }
}));

// Mock environment variables
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_mock';
process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly_mock';
process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly_mock';
process.env.FIREBASE_PROJECT_ID = 'test-project';
