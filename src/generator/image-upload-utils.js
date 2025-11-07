/**
 * Image Upload Utilities for Flux Image Generator
 * Shared utilities for drag and drop image upload functionality
 */

import FluxUI from './main.js';

const ImageUploadUtils = {
  /**
   * Setup drag and drop functionality for an image upload area
   * @param {HTMLElement} labelElement - The drop zone element (usually a label)
   * @param {HTMLInputElement} inputElement - The file input element
   * @param {Function} onFileLoaded - Callback function(dataUrl, fileName) when file is loaded
   */
  setupDragAndDrop: function (labelElement, inputElement, onFileLoaded) {
    if (!labelElement || !inputElement) return;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
      labelElement.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    // Highlight drop zone when dragging over
    ['dragenter', 'dragover'].forEach((eventName) => {
      labelElement.addEventListener(eventName, () => {
        labelElement.classList.add('bg-indigo-50', 'border-indigo-500');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      labelElement.addEventListener(eventName, () => {
        labelElement.classList.remove('bg-indigo-50', 'border-indigo-500');
      });
    });

    // Handle dropped files
    labelElement.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        // Check if it's an image
        if (file.type.startsWith('image/')) {
          // Update the input element
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          inputElement.files = dataTransfer.files;

          // Trigger the change event or call the handler directly
          if (onFileLoaded) {
            const reader = new FileReader();
            reader.onload = (event) => {
              onFileLoaded(event.target.result, file.name);
            };
            reader.readAsDataURL(file);
          } else {
            inputElement.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else {
          FluxUI.showNotification(
            'Please drop an image file (PNG, JPEG, JPG)',
            'warning'
          );
        }
      }
    });
  }
};

export default ImageUploadUtils;
