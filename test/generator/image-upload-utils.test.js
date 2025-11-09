import { describe, it, expect, vi, beforeEach } from 'vitest';
import ImageUploadUtils from '../../src/generator/image-upload-utils.js';

describe('ImageUploadUtils', () => {
  describe('setupDragAndDrop()', () => {
    let labelElement;
    let inputElement;
    let mockCallback;

    beforeEach(() => {
      // Create DOM elements
      labelElement = document.createElement('label');
      inputElement = document.createElement('input');
      inputElement.type = 'file';
      mockCallback = vi.fn();
    });

    it('should handle null elements gracefully', () => {
      expect(() => {
        ImageUploadUtils.setupDragAndDrop(null, null, null);
      }).not.toThrow();
    });

    it('should setup event listeners on valid elements', () => {
      const addEventListenerSpy = vi.spyOn(labelElement, 'addEventListener');

      ImageUploadUtils.setupDragAndDrop(
        labelElement,
        inputElement,
        mockCallback
      );

      // Should have added listeners for drag events
      expect(addEventListenerSpy).toHaveBeenCalled();

      // Check for specific events
      const eventNames = addEventListenerSpy.mock.calls.map((call) => call[0]);
      expect(eventNames).toContain('dragenter');
      expect(eventNames).toContain('dragover');
      expect(eventNames).toContain('dragleave');
      expect(eventNames).toContain('drop');
    });

    it('should add highlight classes on dragenter', () => {
      ImageUploadUtils.setupDragAndDrop(
        labelElement,
        inputElement,
        mockCallback
      );

      const dragEvent = new Event('dragenter', { bubbles: true });
      labelElement.dispatchEvent(dragEvent);

      expect(labelElement.classList.contains('bg-indigo-50')).toBe(true);
      expect(labelElement.classList.contains('border-indigo-500')).toBe(true);
    });

    it('should remove highlight classes on dragleave', () => {
      ImageUploadUtils.setupDragAndDrop(
        labelElement,
        inputElement,
        mockCallback
      );

      // First add the classes
      const dragEnterEvent = new Event('dragenter', { bubbles: true });
      labelElement.dispatchEvent(dragEnterEvent);

      // Then remove them
      const dragLeaveEvent = new Event('dragleave', { bubbles: true });
      labelElement.dispatchEvent(dragLeaveEvent);

      expect(labelElement.classList.contains('bg-indigo-50')).toBe(false);
      expect(labelElement.classList.contains('border-indigo-500')).toBe(false);
    });
  });
});
