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
  const root = createRoot(container);

  // Last-rendered props; update() merges partial options into these so an
  // omitted prop keeps its current value instead of reverting to mount-time.
  let currentProps = {
    activeStyleId: options.activeStyleId ?? null,
    onSelect: options.onSelect,
    disabled: options.disabled ?? false
  };

  const render = () => {
    root.render(
      <RenderStyleSelector
        activeStyleId={currentProps.activeStyleId}
        onSelect={currentProps.onSelect}
        disabled={currentProps.disabled}
      />
    );
  };

  // Initial render
  render();

  return {
    unmount: () => root.unmount(),
    update: (newOptions) => {
      currentProps = { ...currentProps, ...newOptions };
      render();
    }
  };
};

export default mountStyleSelector;
