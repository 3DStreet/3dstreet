/**
 * Mount Video AI Model Selector - Renders React AIModelSelector component for video generator
 */

import { createRoot } from 'react-dom/client';
import AIModelSelector from '@shared/components/AIModelSelector';

/**
 * Mount the ModelSelector component for video generation
 * @param {HTMLElement} container - The DOM element to mount into
 * @param {Object} options - Configuration options
 * @param {string} options.value - Currently selected model ID
 * @param {Function} options.onChange - Callback when model changes
 * @param {boolean} options.disabled - Whether the selector is disabled
 * @returns {Object} - Object with unmount and update functions
 */
export const mountVideoModelSelector = (container, options) => {
  const { value, onChange, disabled = false } = options;

  const root = createRoot(container);

  const render = (props) => {
    root.render(
      <AIModelSelector
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
        mode="video"
      />
    );
  };

  // Initial render
  render({ value, onChange, disabled });

  return {
    unmount: () => root.unmount(),
    update: (newOptions) => {
      render({
        value: newOptions.value,
        onChange: newOptions.onChange ?? onChange,
        disabled: newOptions.disabled ?? disabled
      });
    }
  };
};

export default mountVideoModelSelector;
