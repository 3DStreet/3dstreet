# 3DStreet Test Suite

Tests organized by application namespace, not by framework.

## Structure

```
test/
├── core/           # A-Frame core components (Mocha, legacy)
├── generator/      # Generator app (Vitest)
├── setup.js        # Global test setup (Vitest)
└── README.md       # This file
```

## Quick Start

```bash
# Run ALL tests (core + modern)
npm test

# Modern apps only
npm run test:modern
npm run test:modern:watch      # Watch mode
npm run test:modern:ui         # Visual UI
npm run test:modern:coverage   # Coverage

# Individual apps
npm run test:core              # A-Frame core (Mocha)
npm run test:generator         # Generator only (Vitest)
```

## Test Frameworks

### Vitest (Modern Apps)
Used for: `editor/`, `generator/`, `shared/`

- ✅ Native ES6 modules
- ✅ React Testing Library support
- ✅ Fast with HMR
- ✅ Jest-compatible API

```javascript
// test/editor/components/MyComponent.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import MyComponent from '../../../src/editor/components/MyComponent.jsx';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

### Mocha (Legacy Core)
Used for: `core/` (A-Frame components)

- Legacy CommonJS pattern with `src/tested/` files
- Will eventually migrate to Vitest

```javascript
// test/core/my-component.test.js
const assert = require('assert');
const myComponent = require('../../src/tested/my-component-tested.js');

describe('MyComponent', () => {
  it('should work', () => {
    assert.strictEqual(myComponent.doThing(), true);
  });
});
```

## Coverage

Coverage is tracked separately:

- **Core (Mocha)**: Uses `nyc`
- **Modern (Vitest)**: Uses `v8` provider

## CI Integration

```yaml
# .github/workflows/test.yml
- name: Test Core (A-Frame)
  run: npm run test:core

- name: Test Modern (Editor/Generator/Shared)
  run: npm run test:modern:coverage
```

## Migration Strategy

**Current State:**
- ✅ Generator has Vitest tests
- 🔜 Editor needs tests (use Vitest + React Testing Library)
- 🔜 Shared lib needs tests (use Vitest)
- ⏳ Core will stay on Mocha until fully refactored

**Adding Editor Tests:**
```bash
# Install React testing utilities
npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event

# Create test
# test/editor/components/SceneGraph.test.jsx
```

**Adding Shared Tests:**
```bash
# Create test
# test/shared/utils/tokens.test.js
```

## Best Practices

1. **Organize by feature**: Group related tests together
2. **Co-locate when possible**: Consider `__tests__/` dirs in source
3. **Mock external deps**: Firebase, A-Frame, etc. (see `test/setup.js`)
4. **Test behavior, not implementation**: Focus on user-facing behavior
5. **Keep tests fast**: Mock expensive operations

## File Naming

- Test files: `*.test.js` or `*.test.jsx`
- Setup files: `setup.js`, `helpers.js`
- Mocks: `__mocks__/` directory or inline
