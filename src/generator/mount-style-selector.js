/**
 * Mount Render Style Selector - Renders React RenderStyleSelector component
 * for the image generator (prompt-starter chips below the prompt input)
 */

import { createRoot } from 'react-dom/client';
import RenderStyleSelector from '@shared/components/RenderStyleSelector';

/**
 * Mount the RenderStyleSelector component for image generation
 * @param {HTMLElement} container - The DOM element to mount into
 * @param {Object} options - Configuration options
 * @param {string|null} options.activeStyleId - describeStyleText result for
 *   the style field ('none' lights the none chip; 'custom' lights nothing)
 * @param {Function} options.onSelect - Callback with the clicked style ID
 * @param {boolean} options.disabled - Whether the selector is disabled
 * @returns {Object} - Object with unmount and update functions
 */
export const mountStyleSelector = (container, options) => {
  const { activeStyleId = null, onSelect, disabled = false } = options;

  const root = createRoot(container);

  const render = (props) => {
    root.render(
      <RenderStyleSelector
        activeStyleId={props.activeStyleId}
        onSelect={props.onSelect}
        disabled={props.disabled}
      />
    );
  };

  // Initial render
  render({ activeStyleId, onSelect, disabled });

  return {
    unmount: () => root.unmount(),
    update: (newOptions) => {
      render({
        activeStyleId: newOptions.activeStyleId ?? null,
        onSelect: newOptions.onSelect ?? onSelect,
        disabled: newOptions.disabled ?? disabled
      });
    }
  };
};

export default mountStyleSelector;
