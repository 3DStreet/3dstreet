/**
 * Mount Render Style Selector - Renders React RenderStyleSelector component
 * for the image generator (style preset chips below the prompt input)
 */

import { createRoot } from 'react-dom/client';
import RenderStyleSelector from '@shared/components/RenderStyleSelector';

/**
 * Mount the RenderStyleSelector component for image generation
 * @param {HTMLElement} container - The DOM element to mount into
 * @param {Object} options - Configuration options
 * @param {string} options.value - Currently selected style ID
 * @param {Function} options.onChange - Callback when style changes
 * @param {boolean} options.disabled - Whether the selector is disabled
 * @returns {Object} - Object with unmount and update functions
 */
export const mountStyleSelector = (container, options) => {
  const { value, onChange, disabled = false } = options;

  const root = createRoot(container);

  const render = (props) => {
    root.render(
      <RenderStyleSelector
        value={props.value}
        onChange={props.onChange}
        disabled={props.disabled}
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

export default mountStyleSelector;
