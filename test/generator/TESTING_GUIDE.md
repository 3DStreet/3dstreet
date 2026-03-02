# Generator Component Testing Guide

This guide explains how to test React components in the generator app, serving as a foundation for the React migration.

## Test Structure

```
test/generator/
├── components/           # React component tests
│   └── PurchaseModal.test.jsx
├── test-utils.jsx        # Shared test utilities
├── api.test.js           # API module tests
├── image-upload-utils.test.js
└── TESTING_GUIDE.md      # This file
```

## Quick Start

### Running Tests

```bash
# Run all generator tests
npm run test:generator

# Run with watch mode
npm run test:modern:watch

# Run with UI
npm run test:modern:ui

# Run with coverage
npm run test:modern:coverage
```

### Writing a New Component Test

1. Create a test file in `test/generator/components/`:

```jsx
// test/generator/components/MyComponent.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { httpsCallable } from 'firebase/functions';
import MyComponent from '../../../src/generator/components/MyComponent';
import { AuthContext } from '@shared/contexts';
import { createMockUser, createMockTokenProfile } from '../test-utils';

// Helper to render with providers
const renderMyComponent = (props = {}, authValue = {}) => {
  const defaultAuthValue = {
    currentUser: createMockUser(),
    tokenProfile: createMockTokenProfile(),
    refreshTokenProfile: vi.fn(),
    isLoading: false,
    ...authValue
  };

  return render(
    <AuthContext.Provider value={defaultAuthValue}>
      <MyComponent {...props} />
    </AuthContext.Provider>
  );
};

describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render correctly', () => {
    renderMyComponent();
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('should handle user interactions', async () => {
    const user = userEvent.setup();
    renderMyComponent();

    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
    });
  });
});
```

## Test Utilities

### Available Helpers (`test-utils.jsx`)

```jsx
import {
  createMockUser,
  createMockTokenProfile,
  createMockCallable,
  createMockCallableError,
  MockAuthProvider,
  renderWithProviders
} from '../test-utils';

// Create a mock user
const user = createMockUser({ isPro: true });

// Create mock token profile
const tokens = createMockTokenProfile({ genToken: 50 });

// Mock Firebase callable function
httpsCallable.mockReturnValue(createMockCallable({ result: 'success' }));

// Mock callable that throws error
httpsCallable.mockReturnValue(createMockCallableError('error-code', 'Error message'));
```

### Mocking Firebase Functions

Firebase functions are mocked globally in `test/setup.js`. To customize behavior per test:

```jsx
import { httpsCallable } from 'firebase/functions';

beforeEach(() => {
  // Default mock - returns empty data
  httpsCallable.mockReturnValue(() => Promise.resolve({ data: {} }));
});

it('should handle specific Firebase response', async () => {
  httpsCallable.mockImplementation((_, functionName) => {
    if (functionName === 'myFunction') {
      return () => Promise.resolve({ data: { specific: 'response' } });
    }
    return () => Promise.resolve({ data: {} });
  });

  // Test code...
});
```

### Testing with Zustand Store

```jsx
import useImageGenStore from '../../../src/generator/store';

beforeEach(() => {
  // Reset store state
  useImageGenStore.setState({ modal: null });
});

it('should update store', async () => {
  // Set initial state
  useImageGenStore.setState({ modal: 'purchase' });

  // Render and interact...

  // Verify store state
  expect(useImageGenStore.getState().modal).toBeNull();
});
```

## Testing Patterns

### 1. Visibility/Conditional Rendering

```jsx
describe('Visibility', () => {
  it('should not render when condition is false', () => {
    renderMyComponent({ visible: false });
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('should render when condition is true', () => {
    renderMyComponent({ visible: true });
    expect(screen.getByText('Content')).toBeInTheDocument();
  });
});
```

### 2. User Interactions

```jsx
describe('Interactions', () => {
  it('should handle button clicks', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderMyComponent({ onSubmit });

    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('should handle form input', async () => {
    const user = userEvent.setup();
    renderMyComponent();

    await user.type(screen.getByRole('textbox'), 'Hello');

    expect(screen.getByRole('textbox')).toHaveValue('Hello');
  });
});
```

### 3. Async Operations

```jsx
describe('Async Operations', () => {
  it('should show loading state', async () => {
    const user = userEvent.setup();
    renderMyComponent();

    await user.click(screen.getByText('Load Data'));

    // Check loading state appears
    expect(screen.getByText('Loading...')).toBeInTheDocument();

    // Wait for completion
    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
  });
});
```

### 4. Keyboard Navigation

```jsx
describe('Keyboard', () => {
  it('should close on Escape', () => {
    renderMyComponent({ isOpen: true });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText('Modal Content')).not.toBeInTheDocument();
  });
});
```

### 5. Accessibility

```jsx
describe('Accessibility', () => {
  it('should have proper ARIA labels', () => {
    renderMyComponent();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('should have proper heading hierarchy', () => {
    renderMyComponent();
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveTextContent('Expected Title');
  });
});
```

## Migration Notes

### Testing for React Migration

When migrating vanilla JS tabs to React:

1. **Write behavioral tests first** - Focus on what the UI should do, not implementation
2. **Test user interactions** - Click, type, navigate
3. **Test state changes** - Loading, success, error states
4. **Keep tests stable** - Tests should pass for both vanilla JS wrapper and React implementation

### Example Migration Test

```jsx
// This test should work for both the current vanilla JS implementation
// AND the future React implementation

describe('Modify Tab Behavior', () => {
  it('should disable generate button when no image is uploaded', () => {
    // Works with either implementation
    renderModifyTab();
    const generateBtn = screen.getByRole('button', { name: /generate/i });
    expect(generateBtn).toBeDisabled();
  });

  it('should enable generate button when image is provided', async () => {
    const user = userEvent.setup();
    renderModifyTab();

    // Upload image
    await uploadTestImage();

    const generateBtn = screen.getByRole('button', { name: /generate/i });
    expect(generateBtn).toBeEnabled();
  });
});
```

## Mocked Dependencies

The following are automatically mocked in `test/setup.js`:

- `firebase/functions` - `httpsCallable`, `getFunctions`
- `@shared/services/firebase.js` - `functions`, `auth`, `db`, `storage`
- `@stripe/stripe-js` - `loadStripe`
- `@stripe/react-stripe-js` - `EmbeddedCheckoutProvider`, `EmbeddedCheckout`
- `posthog-js` - Analytics (identify, capture, reset)
- `@shared/utils/tokens` - `getTokenProfile`, `checkAndRefillProTokens`
- `@shared/auth/api/user` - `isUserPro`

## Common Issues

### JSX in .js files

The vitest config handles JSX in `.js` files automatically via esbuild configuration.

### React is not defined

The vitest config uses `jsx: 'automatic'` to auto-import React.

### Module not found

Check that the `@shared` alias is configured in `vitest.config.js`.

### Async timeouts

Increase timeout or use `waitFor` with custom timeout:

```jsx
await waitFor(() => {
  expect(screen.getByText('Result')).toBeInTheDocument();
}, { timeout: 5000 });
```
