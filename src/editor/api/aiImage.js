import { getAuth } from 'firebase/auth';

/**
 * Takes a screenshot of the current scene and enhances it with AI
 * @param {string} prompt - Optional custom prompt for AI enhancement
 * @returns {Promise<Object>} Enhanced image data
 */
export const enhanceSceneWithAI = async (prompt) => {
  try {
    // First, take a screenshot using the existing screentock system
    const imageBase64 = await captureSceneScreenshot();

    if (!imageBase64) {
      throw new Error('Failed to capture scene screenshot');
    }

    // Get current scene data (optional)
    const sceneId = STREET.utils.getCurrentSceneId();

    console.log('Calling Python OpenAI enhancement function...');

    // Get Firebase auth token for authentication
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to use AI enhancement');
    }

    const token = await user.getIdToken();

    // Make direct HTTP request to the Cloud Function
    const url =
      'https://us-central1-dev-3dstreet.cloudfunctions.net/enhanceImagePython';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageBase64: imageBase64,
        prompt:
          prompt ||
          'Convert this low-poly 3D street scene into a photorealistic urban environment with realistic lighting, textures, and details',
        sceneData: { sceneId } // Optional metadata
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const responseData = await response.json();

    console.log('Response data from Python function:', responseData);

    if (!responseData.success) {
      throw new Error(
        responseData.error || 'Unknown error from enhancement service'
      );
    }

    // Transform the response to match the expected format
    const result = {
      success: true,
      enhanced_image_base64: responseData.imageData,
      original_prompt: responseData.original_prompt,
      revised_prompt: responseData.revised_prompt
    };

    console.log('Returning result:', {
      ...result,
      enhanced_image_base64: result.enhanced_image_base64
        ? `${result.enhanced_image_base64.substring(0, 50)}...`
        : 'missing'
    });

    return result;
  } catch (error) {
    console.error('Error enhancing scene with AI:', error);
    throw error;
  }
};

/**
 * Captures a screenshot of the current 3D scene
 * @returns {Promise<string>} Base64 encoded image data
 */
const captureSceneScreenshot = () => {
  return new Promise((resolve, reject) => {
    try {
      // Get the screenshot element
      const screenshotEl = document.getElementById('screenshot');
      if (!screenshotEl) {
        reject(new Error('Screenshot element not found'));
        return;
      }

      // Make sure it's playing
      if (!screenshotEl.isPlaying) {
        screenshotEl.play();
      }

      // Set up the destination image element
      let imgElement = document.getElementById('screentock-destination');
      if (!imgElement) {
        // Create temporary image element if it doesn't exist
        imgElement = document.createElement('img');
        imgElement.id = 'screentock-destination-temp';
        imgElement.style.display = 'none';
        document.body.appendChild(imgElement);
      }

      // Configure screentock to output to image element
      screenshotEl.setAttribute(
        'screentock',
        'imgElementSelector',
        `#${imgElement.id}`
      );
      screenshotEl.setAttribute('screentock', 'type', 'img');

      // Set up event listener for when the image loads
      const onImageLoad = () => {
        imgElement.removeEventListener('load', onImageLoad);

        // Get the image data
        const imageData = imgElement.src;

        // Clean up temporary element if we created one
        if (imgElement.id === 'screentock-destination-temp') {
          document.body.removeChild(imgElement);
        }

        resolve(imageData);
      };

      // Set up error handler
      const onImageError = (error) => {
        imgElement.removeEventListener('error', onImageError);
        imgElement.removeEventListener('load', onImageLoad);

        // Clean up temporary element if we created one
        if (imgElement.id === 'screentock-destination-temp') {
          document.body.removeChild(imgElement);
        }

        reject(error || new Error('Failed to load screenshot image'));
      };

      // Add event listeners
      imgElement.addEventListener('load', onImageLoad);
      imgElement.addEventListener('error', onImageError);

      // Trigger the screenshot
      screenshotEl.setAttribute('screentock', 'takeScreenshot', true);

      // Fallback timeout in case the image never loads
      setTimeout(() => {
        if (imgElement.src && imgElement.src.startsWith('data:')) {
          // Image data is available, resolve even without load event
          imgElement.removeEventListener('load', onImageLoad);
          imgElement.removeEventListener('error', onImageError);

          const imageData = imgElement.src;

          if (imgElement.id === 'screentock-destination-temp') {
            document.body.removeChild(imgElement);
          }

          resolve(imageData);
        } else {
          // Timeout without success
          imgElement.removeEventListener('load', onImageLoad);
          imgElement.removeEventListener('error', onImageError);

          if (imgElement.id === 'screentock-destination-temp') {
            document.body.removeChild(imgElement);
          }

          reject(new Error('Screenshot capture timed out'));
        }
      }, 5000); // 5 second timeout
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Helper function to display an enhanced image result
 * @param {string} imageBase64 - Base64 encoded image data
 * @param {string} prompt - The prompt used for enhancement
 */
export const displayEnhancedImage = (imageBase64, prompt) => {
  try {
    // Create a new image element to display the result
    const img = document.createElement('img');
    img.src = `data:image/png;base64,${imageBase64}`;
    img.style.cssText = `
      max-width: 100%;
      max-height: 500px;
      border: 2px solid #ccc;
      border-radius: 8px;
      margin: 10px 0;
    `;
    img.alt = `AI Enhanced Scene: ${prompt}`;

    return img;
  } catch (error) {
    console.error('Error displaying enhanced image:', error);
    return null;
  }
};
