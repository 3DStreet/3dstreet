/**
 * Mount AI Model Selector - Renders React AIModelSelector component for image generator
 */

import { createRoot } from 'react-dom/client';
import AIModelSelector from '@shared/components/AIModelSelector';

/**
 * Mount the ModelSelector component for image generation
 * @param {HTMLElement} container - The DOM element to mount into
 * @param {Object} options - Configuration options
 * @param {string} options.value - Currently selected model ID
 * @param {Function} options.onChange - Callback when model changes
 * @param {boolean} options.disabled - Whether the selector is disabled
 * @param {boolean} options.hasSourceImage - Whether source image is available (filters fal models when false)
 * @returns {Object} - Object with unmount and update functions
 */
export const mountModelSelector = (container, options) => {
  const { value, onChange, disabled = false, hasSourceImage = true } = options;

  const root = createRoot(container);

  const render = (props) => {
    root.render(
      <AIModelSelector
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
        hasSourceImage={props.hasSourceImage}
      />
    );
  };

  // Initial render
  render({ value, onChange, disabled, hasSourceImage });

  return {
    unmount: () => root.unmount(),
    update: (newOptions) => {
      render({
        value: newOptions.value,
        onChange: newOptions.onChange ?? onChange,
        disabled: newOptions.disabled ?? disabled,
        hasSourceImage: newOptions.hasSourceImage ?? hasSourceImage
      });
    }
  };
};

export default mountModelSelector;
