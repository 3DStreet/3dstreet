import { vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import * as THREE from 'three';

// A-Frame exposes THREE as a global at runtime; the nav modules read it as one
// (they `/* global THREE */` and import `three` nowhere), and `ExperimentalControls`
// extends `THREE.EventDispatcher` at module-eval — so THREE must already be present
// the moment a nav module is imported. Mirror that here so a direct SUT import —
// which evaluates before a test's own beforeAll — always finds THREE present.
if (!globalThis.THREE) globalThis.THREE = THREE;

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
      isProTeam: false,
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

// jsdom doesn't implement URL.createObjectURL / revokeObjectURL, and its
// fetch doesn't understand blob: URLs. Shim both so tests that round-trip
// Blob -> object URL -> fetch -> Blob work in the test environment.
if (typeof URL.createObjectURL !== 'function') {
  const blobStore = new Map();
  URL.createObjectURL = (blob) => {
    const url = `blob:mock/${Math.random().toString(36).slice(2)}`;
    blobStore.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url) => {
    blobStore.delete(url);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.startsWith('blob:mock/')) {
      const blob = blobStore.get(url);
      if (!blob) return Promise.reject(new Error('blob URL not found'));
      return Promise.resolve(new Response(blob));
    }
    return originalFetch(input, init);
  };
}

// Mock environment variables
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_mock';
process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly_mock';
process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly_mock';
process.env.FIREBASE_PROJECT_ID = 'test-project';
