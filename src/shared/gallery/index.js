/**
 * Shared Gallery Module - Barrel export
 */

export { default as galleryService } from './services/galleryService.js';
export { default as useGallery } from './hooks/useGallery.js';
export {
  Gallery,
  GallerySidebar,
  GalleryGrid,
  GalleryItem,
  GalleryModal
} from './components/index.js';
