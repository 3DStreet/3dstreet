import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FluxAPI from '../../src/generator/api.js';

describe('FluxAPI', () => {
  describe('getProxiedImageUrl()', () => {
    let originalWindow;

    beforeEach(() => {
      originalWindow = global.window;
    });

    afterEach(() => {
      global.window = originalWindow;
    });

    it('should return relative path for production', () => {
      global.window = {
        location: {
          hostname: 'app.3dstreet.com'
        }
      };

      const originalUrl = 'https://example.com/image.jpg';
      const result = FluxAPI.getProxiedImageUrl(originalUrl);

      expect(result).toMatch(/^\/bflProxyImage\?url=/);
      expect(result).toContain(encodeURIComponent(originalUrl));
    });

    it('should return full Firebase URL for localhost', () => {
      global.window = {
        location: {
          hostname: 'localhost'
        }
      };

      const originalUrl = 'https://example.com/image.jpg';
      const result = FluxAPI.getProxiedImageUrl(originalUrl);

      expect(result).toContain('us-central1-');
      expect(result).toContain('cloudfunctions.net/bflProxyImage');
      expect(result).toContain(encodeURIComponent(originalUrl));
    });

    it('should handle 127.0.0.1 as localhost', () => {
      global.window = {
        location: {
          hostname: '127.0.0.1'
        }
      };

      const originalUrl = 'https://example.com/image.jpg';
      const result = FluxAPI.getProxiedImageUrl(originalUrl);

      expect(result).toContain('cloudfunctions.net');
    });
  });

  describe('makeRequest()', () => {
    it('should exist as a function', () => {
      expect(FluxAPI.makeRequest).toBeDefined();
      expect(typeof FluxAPI.makeRequest).toBe('function');
    });

    // TODO: Add tests with mocked Firebase functions
  });

  describe('pollForResult()', () => {
    it('should exist as a function', () => {
      expect(FluxAPI.pollForResult).toBeDefined();
      expect(typeof FluxAPI.pollForResult).toBe('function');
    });

    // TODO: Add tests with mocked polling behavior
  });
});
