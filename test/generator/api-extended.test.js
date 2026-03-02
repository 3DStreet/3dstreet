/**
 * Extended FluxAPI Tests
 *
 * Tests the core API logic that will become React hooks:
 * - makeRequest error handling
 * - pollForResult status handling and URL extraction
 * - getProxiedImageUrl URL building
 *
 * These tests validate the logic contracts that must be preserved
 * during React migration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { httpsCallable } from 'firebase/functions';
import FluxAPI from '../../src/generator/api.js';

describe('FluxAPI - Extended Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('makeRequest() - Error Handling', () => {
    it('should return result with remainingTokens on success', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: { id: 'task-123', status: 'pending' },
          remainingTokens: 45
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const result = await FluxAPI.makeRequest('flux-pro', { prompt: 'test' });

      expect(result.id).toBe('task-123');
      expect(result.remainingTokens).toBe(45);
    });

    it('should throw on API failure with error message', async () => {
      const mockResponse = {
        data: {
          success: false,
          error: 'Rate limit exceeded'
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      await expect(
        FluxAPI.makeRequest('flux-pro', { prompt: 'test' })
      ).rejects.toThrow('Rate limit exceeded');
    });

    it('should throw generic message when no error provided', async () => {
      const mockResponse = {
        data: {
          success: false
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      await expect(
        FluxAPI.makeRequest('flux-pro', { prompt: 'test' })
      ).rejects.toThrow('API request failed');
    });

    it('should handle unauthenticated error code', async () => {
      const error = new Error('Unauthenticated');
      error.code = 'unauthenticated';

      httpsCallable.mockReturnValue(() => Promise.reject(error));

      await expect(
        FluxAPI.makeRequest('flux-pro', { prompt: 'test' })
      ).rejects.toThrow('Please sign in to use image generation');
    });

    it('should handle resource-exhausted error code (no tokens)', async () => {
      const error = new Error('Resource exhausted');
      error.code = 'resource-exhausted';

      httpsCallable.mockReturnValue(() => Promise.reject(error));

      await expect(
        FluxAPI.makeRequest('flux-pro', { prompt: 'test' })
      ).rejects.toThrow(
        'No tokens available. Please purchase more tokens or upgrade to Pro.'
      );
    });

    it('should pass through other error messages', async () => {
      const error = new Error('Custom error message');

      httpsCallable.mockReturnValue(() => Promise.reject(error));

      await expect(
        FluxAPI.makeRequest('flux-pro', { prompt: 'test' })
      ).rejects.toThrow('Custom error message');
    });

    it('should call bflApiProxy with correct parameters', async () => {
      const mockCallable = vi.fn().mockResolvedValue({
        data: { success: true, result: {}, remainingTokens: 10 }
      });
      httpsCallable.mockReturnValue(mockCallable);

      await FluxAPI.makeRequest('flux-pro-1.1', { prompt: 'test', width: 1024 });

      expect(mockCallable).toHaveBeenCalledWith({
        endpoint: 'flux-pro-1.1',
        method: 'POST',
        params: { prompt: 'test', width: 1024 }
      });
    });

    it('should support custom HTTP methods', async () => {
      const mockCallable = vi.fn().mockResolvedValue({
        data: { success: true, result: {}, remainingTokens: 10 }
      });
      httpsCallable.mockReturnValue(mockCallable);

      await FluxAPI.makeRequest('get_result', { id: 'task-123' }, 'GET');

      expect(mockCallable).toHaveBeenCalledWith({
        endpoint: 'get_result',
        method: 'GET',
        params: { id: 'task-123' }
      });
    });
  });

  describe('pollForResult() - Status Handling', () => {
    it('should call onSuccess with imageUrl when status is Ready', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Ready',
            result: { sample: 'https://example.com/image.jpg' }
          },
          remainingTokens: 40
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onProgress = vi.fn();
      const onSuccess = vi.fn();
      const onError = vi.fn();

      await FluxAPI.pollForResult('task-123', onProgress, onSuccess, onError);

      // Wait for async callback
      await vi.waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          'https://example.com/image.jpg',
          mockResponse.data.result,
          40
        );
      });

      expect(onError).not.toHaveBeenCalled();
    });

    it('should extract URL from result.sample', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Ready',
            result: { sample: 'https://cdn.example.com/sample.png' }
          },
          remainingTokens: 10
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onSuccess = vi.fn();

      await FluxAPI.pollForResult('task-123', vi.fn(), onSuccess, vi.fn());

      await vi.waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          'https://cdn.example.com/sample.png',
          expect.anything(),
          expect.anything()
        );
      });
    });

    it('should extract URL from string result', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Ready',
            result: 'https://direct-url.com/image.jpg'
          },
          remainingTokens: 10
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onSuccess = vi.fn();

      await FluxAPI.pollForResult('task-123', vi.fn(), onSuccess, vi.fn());

      await vi.waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          'https://direct-url.com/image.jpg',
          expect.anything(),
          expect.anything()
        );
      });
    });

    it('should extract URL from result.image', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Ready',
            result: { image: 'https://cdn.example.com/image.png' }
          },
          remainingTokens: 10
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onSuccess = vi.fn();

      await FluxAPI.pollForResult('task-123', vi.fn(), onSuccess, vi.fn());

      await vi.waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          'https://cdn.example.com/image.png',
          expect.anything(),
          expect.anything()
        );
      });
    });

    it('should extract URL from result.url', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Ready',
            result: { url: 'https://cdn.example.com/url.png' }
          },
          remainingTokens: 10
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onSuccess = vi.fn();

      await FluxAPI.pollForResult('task-123', vi.fn(), onSuccess, vi.fn());

      await vi.waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          'https://cdn.example.com/url.png',
          expect.anything(),
          expect.anything()
        );
      });
    });

    it('should call onError when status is Error', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Error',
            details: 'Model failed to generate'
          }
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onError = vi.fn();

      await FluxAPI.pollForResult('task-123', vi.fn(), vi.fn(), onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Model failed to generate')
          })
        );
      });
    });

    it('should call onError when content is moderated', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Content Moderated'
          }
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onError = vi.fn();

      await FluxAPI.pollForResult('task-123', vi.fn(), vi.fn(), onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Content was moderated')
          })
        );
      });
    });

    it('should call onError when request is moderated', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Request Moderated'
          }
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onError = vi.fn();

      await FluxAPI.pollForResult('task-123', vi.fn(), vi.fn(), onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Content was moderated')
          })
        );
      });
    });

    it('should call onError when no image URL found', async () => {
      const mockResponse = {
        data: {
          success: true,
          result: {
            status: 'Ready',
            result: { unexpected_field: 'value' }
          }
        }
      };

      httpsCallable.mockReturnValue(() => Promise.resolve(mockResponse));

      const onError = vi.fn();

      await FluxAPI.pollForResult('task-123', vi.fn(), vi.fn(), onError);

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('No image URL found')
          })
        );
      });
    });

    it('should call onProgress when progress is available', async () => {
      let callCount = 0;
      const mockCallable = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              success: true,
              result: { status: 'Processing', progress: 50 }
            }
          });
        }
        return Promise.resolve({
          data: {
            success: true,
            result: {
              status: 'Ready',
              result: { sample: 'https://example.com/done.jpg' }
            },
            remainingTokens: 10
          }
        });
      });

      httpsCallable.mockReturnValue(mockCallable);

      const onProgress = vi.fn();
      const onSuccess = vi.fn();

      await FluxAPI.pollForResult('task-123', onProgress, onSuccess, vi.fn());

      await vi.waitFor(() => {
        expect(onProgress).toHaveBeenCalledWith(50);
      });
    });
  });

  describe('getProxiedImageUrl() - URL Building', () => {
    let originalWindow;

    beforeEach(() => {
      originalWindow = global.window;
    });

    afterEach(() => {
      global.window = originalWindow;
    });

    it('should return relative path for production hostname', () => {
      global.window = { location: { hostname: 'app.3dstreet.com' } };

      const result = FluxAPI.getProxiedImageUrl(
        'https://cdn.bfl.ai/image.jpg'
      );

      expect(result).toBe(
        '/bflProxyImage?url=https%3A%2F%2Fcdn.bfl.ai%2Fimage.jpg'
      );
    });

    it('should return full Firebase URL for localhost', () => {
      global.window = { location: { hostname: 'localhost' } };

      const result = FluxAPI.getProxiedImageUrl(
        'https://cdn.bfl.ai/image.jpg'
      );

      expect(result).toContain('cloudfunctions.net/bflProxyImage');
      expect(result).toContain('url=https%3A%2F%2Fcdn.bfl.ai%2Fimage.jpg');
    });

    it('should return full Firebase URL for 127.0.0.1', () => {
      global.window = { location: { hostname: '127.0.0.1' } };

      const result = FluxAPI.getProxiedImageUrl(
        'https://cdn.bfl.ai/image.jpg'
      );

      expect(result).toContain('cloudfunctions.net/bflProxyImage');
    });

    it('should properly encode special characters in URL', () => {
      global.window = { location: { hostname: 'app.3dstreet.com' } };

      const result = FluxAPI.getProxiedImageUrl(
        'https://cdn.bfl.ai/path/image name.jpg?param=value&other=123'
      );

      expect(result).toContain(
        encodeURIComponent(
          'https://cdn.bfl.ai/path/image name.jpg?param=value&other=123'
        )
      );
    });

    it('should return relative path for staging hostname', () => {
      global.window = { location: { hostname: 'dev.3dstreet.com' } };

      const result = FluxAPI.getProxiedImageUrl(
        'https://cdn.bfl.ai/image.jpg'
      );

      expect(result).toMatch(/^\/bflProxyImage\?url=/);
    });
  });
});

/**
 * Extractable Pure Functions for React Migration
 *
 * These patterns can be extracted into a useFluxAPI hook:
 *
 * const useFluxAPI = () => {
 *   const makeRequest = useCallback(async (endpoint, params) => {...}, []);
 *   const pollForResult = useCallback((taskId, callbacks) => {...}, []);
 *   return { makeRequest, pollForResult };
 * };
 */
