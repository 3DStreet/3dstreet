/**
 * Flux Image Generator - API JS
 * Handles API communication for all tabs
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from '../editor/services/firebase.js';

// Global API functions
const FluxAPI = {
  // Make an API request to a Flux endpoint
  makeRequest: async function (endpoint, params, method = 'POST') {
    try {
      // Use Firebase callable function
      const bflApiProxy = httpsCallable(functions, 'bflApiProxy');

      const result = await bflApiProxy({
        endpoint: endpoint,
        method: method,
        params: params
      });

      if (!result.data.success) {
        throw new Error(result.data.error || 'API request failed');
      }

      // Return the result and remaining tokens
      return {
        ...result.data.result,
        remainingTokens: result.data.remainingTokens
      };
    } catch (error) {
      console.error('API request error:', error);

      // Extract user-friendly error message
      let errorMessage = 'API request failed';

      if (error.code === 'unauthenticated') {
        errorMessage = 'Please sign in to use image generation';
      } else if (error.code === 'resource-exhausted') {
        errorMessage =
          'No tokens available. Please purchase more tokens or upgrade to Pro.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      throw new Error(errorMessage);
    }
  },

  // Poll for a task result
  pollForResult: async function (taskId, onProgress, onSuccess, onError) {
    const checkResult = async () => {
      try {
        // Use Firebase callable function for polling
        const bflApiProxy = httpsCallable(functions, 'bflApiProxy');

        const response = await bflApiProxy({
          endpoint: 'get_result',
          method: 'GET',
          params: { id: taskId }
        });

        if (!response.data.success) {
          throw new Error(response.data.error || 'Failed to get result');
        }

        const result = response.data.result;
        if (result.status === 'Ready' && result.result) {
          // Generation completed successfully
          let imageUrl;

          // Extract the URL from the correct location in the response
          if (result.result.sample) {
            imageUrl = result.result.sample;
          } else if (typeof result.result === 'string') {
            imageUrl = result.result;
          } else if (result.result.image) {
            imageUrl = result.result.image;
          } else if (result.result.url) {
            imageUrl = result.result.url;
          }

          if (!imageUrl) {
            throw new Error('No image URL found in response');
          } // Return the image URL and full result (including remaining tokens)
          onSuccess(imageUrl, result, response.data.remainingTokens);
        } else if (result.status === 'Error') {
          // Generation failed
          onError(
            new Error(`Generation error: ${result.details || 'Unknown error'}`)
          );
        } else if (
          result.status === 'Content Moderated' ||
          result.status === 'Request Moderated'
        ) {
          // Content was moderated
          onError(
            new Error(
              'Content was moderated. Please adjust your prompt and try again.'
            )
          );
        } else if (result.progress !== undefined) {
          // Still processing with progress
          onProgress(result.progress);
          setTimeout(checkResult, 1000);
        } else {
          // Still processing, no progress info
          setTimeout(checkResult, 1000);
        }
      } catch (error) {
        console.error('Error polling for result:', error);
        onError(error);
      }
    };

    // Start polling
    checkResult();
  },

  // Get a proxied image URL
  getProxiedImageUrl: function (originalUrl) {
    return `/bflProxyImage?url=${encodeURIComponent(originalUrl)}`;
  }
};

export default FluxAPI;
