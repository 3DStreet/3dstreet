import { vi } from 'vitest';

// Mock Firebase modules
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
  getFunctions: vi.fn()
}));

vi.mock('@shared/services/firebase.js', () => ({
  functions: {},
  auth: {},
  db: {},
  storage: {}
}));

// Mock FluxUI for image-upload-utils
vi.mock('../../src/generator/main.js', () => ({
  default: {
    showNotification: vi.fn()
  }
}));
