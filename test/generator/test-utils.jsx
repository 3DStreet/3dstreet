/**
 * Test utilities for generator components
 * Provides wrappers and helpers for rendering components with required providers
 */
import { render } from '@testing-library/react';
import { createContext, useContext } from 'react';

// Create a mock AuthContext for testing
export const MockAuthContext = createContext({
  currentUser: null,
  tokenProfile: null,
  refreshTokenProfile: () => Promise.resolve(),
  isLoading: false
});

export const useMockAuthContext = () => useContext(MockAuthContext);

/**
 * Mock AuthProvider for testing
 * @param {Object} props
 * @param {Object} props.value - Auth context value to provide
 * @param {React.ReactNode} props.children - Child components
 */
export const MockAuthProvider = ({ children, value = {} }) => {
  const defaultValue = {
    currentUser: null,
    tokenProfile: null,
    refreshTokenProfile: () => Promise.resolve(),
    isLoading: false,
    ...value
  };

  return (
    <MockAuthContext.Provider value={defaultValue}>
      {children}
    </MockAuthContext.Provider>
  );
};

/**
 * Create a mock user object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock user object
 */
export const createMockUser = (overrides = {}) => ({
  uid: 'test-user-123',
  email: 'test@example.com',
  displayName: 'Test User',
  isPro: false,
  isProSubscription: false,
  isProDomain: false,
  teamDomain: null,
  getIdToken: () => Promise.resolve('mock-token'),
  ...overrides
});

/**
 * Create a mock token profile
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock token profile
 */
export const createMockTokenProfile = (overrides = {}) => ({
  genToken: 10,
  credToken: 0,
  lastRefill: new Date().toISOString(),
  ...overrides
});

/**
 * Custom render function that wraps components with necessary providers
 * @param {React.ReactElement} ui - Component to render
 * @param {Object} options - Render options
 * @param {Object} options.authValue - Auth context value
 * @param {Object} options.storeValue - Zustand store initial state
 * @returns {Object} Render result with additional utilities
 */
export const renderWithProviders = (
  ui,
  { authValue = {}, ...renderOptions } = {}
) => {
  const Wrapper = ({ children }) => (
    <MockAuthProvider value={authValue}>{children}</MockAuthProvider>
  );

  return {
    ...render(ui, { wrapper: Wrapper, ...renderOptions })
  };
};

/**
 * Wait for async state updates to complete
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise} Resolves after timeout
 */
export const waitForStateUpdate = (ms = 0) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create a mock for Firebase httpsCallable that returns a function
 * @param {Object|Function} response - Response data or function returning response
 * @returns {Function} Mock callable function
 */
export const createMockCallable = (response) => {
  return () => {
    if (typeof response === 'function') {
      return response();
    }
    return Promise.resolve({ data: response });
  };
};

/**
 * Create a mock that simulates a Firebase function error
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @returns {Function} Mock callable that rejects
 */
export const createMockCallableError = (code, message) => {
  return () => {
    const error = new Error(message);
    error.code = code;
    return Promise.reject(error);
  };
};

export { render };
